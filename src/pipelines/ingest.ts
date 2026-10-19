import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { generateEmbeddings } from '../services/embeddings';
import { runIngestionAgent, contentCharLimit, renderPromptContext } from '../agents/ingestion-agent';
import { extractFacts } from '../agents/fact-extractor';
import { splitIntoSections } from '../text/sections';
import { config } from '../config';
import { INGESTION_SYSTEM_PROMPT } from '../prompts/ingestion';
import { RequestTooLargeError } from '../services/openai';
import { countTokens, contentTokenBudget } from '../services/token-budget';
import { writeLegacyOutputs } from './legacy-writes';
import { writeJournalFacts } from '../brain/write-journal-facts';
import type { PromoterRunResult } from '../brain/run-promoter';
import { runCook0Step, consolidateFacts } from './after-reading';
import { claimWork, releaseClaim } from './claim-work';
import { Trace, TraceTrigger } from './trace';
import type {
  DbGoal,
  DbInsight,
  DbRawContent,
  DbUserUnderstanding,
  IngestionResult,
  UserUnderstandingDocument,
} from '../types';

export interface IngestOptions {
  userId: string;
  daysBack?: number;
  /** If provided, only ingest these specific raw_content rows. */
  rawContentIds?: string[];
  triggeredBy?: TraceTrigger;
  dryRun?: boolean;
  /** Deliberately reprocess completed content. Reserved for explicit replay/debug flows. */
  force?: boolean;
  notes?: string;
}

export interface IngestSummary {
  /** Facts written to the graph from this run. */
  facts_written?: number;
  /** Rows returned to 'pending' because a previous run died holding them. */
  leases_reclaimed?: number;
  /** Source rows that gained an embedding in this run. */
  raw_content_embedded?: number;
  patterns_created?: number;
  patterns_promoted?: number;
  whys_created?: number;
  /** Rows that already had facts, so extraction was skipped. */
  rows_skipped_already_have_facts?: number;
  /** Claims discarded because their quote was not in the source. A high
   *  number here means the extraction prompt is wrong, not the verifier. */
  facts_dropped?: number;
  /** How many batches the model refused as too large and we had to halve.
   *  Persistently non-zero means the token budget is set too high. */
  batches_split?: number;
  fact_drop_reasons?: Record<string, number>;
  /** Candidates where the user named their own loop -- promoter seeds. */
  self_named_loops?: number;
  fact_write_errors?: string[];
  traceId: string | null;
  observations_created: number;
  insights_created: number;
  goal_candidates_created: number;
  identity_inferences_created: number;
  raw_content_processed: number;
  batches_run: number;
  user_understanding_version: number | null;
  cook0_failed: boolean;
  cook0_error?: string;
  processingNotes?: string;
  result: IngestionResult;
}

/**
 * The batch budget is now measured, not assumed.
 *
 * This used to be a character constant converted to tokens with a fixed ratio.
 * That ratio is not fixed -- prose, JSON connector payloads and transcripts
 * tokenize very differently -- and a character budget can only ever approximate
 * a limit that is expressed in tokens. When the approximation was wrong in the
 * unsafe direction the request was refused outright and the entries were marked
 * permanently failed.
 *
 * Tokens are now counted locally, which costs microseconds and nothing in
 * money. Residual error is covered by the split-on-refusal path in runIngest:
 * the aim is to be right nearly always and to recover cleanly when we are not.
 */

export { RETRY_LIMIT_PER_RUN, FRESH_LIMIT_PER_RUN } from './claim-work';

/** Tokens one entry will actually contribute, measured on the truncated body. */
export function estimateEntryTokens(rc: DbRawContent): number {
  return countTokens(rc.content.slice(0, contentCharLimit(rc.content_type)));
}

/**
 * The fixed cost of a call, measured by rendering the real prompt context.
 *
 * An earlier version of this ran JSON.stringify over the raw objects and
 * reported 614,896 tokens, because the stored document and the full insight
 * rows are vastly larger than what is actually sent -- insights are capped at
 * 25 and reduced to one line each. The content budget collapsed to its floor
 * and a single run became 411 calls of one entry, which is the exact waste
 * batching exists to avoid.
 *
 * Measuring the rendered string removes the guess entirely.
 */
export function measureOverheadTokens(input: {
  recentInsights: DbInsight[];
  activeGoals: DbGoal[];
  openGoalCandidates: { id: string; title: string; description: string | null }[];
  currentDocument: UserUnderstandingDocument | null;
}): number {
  return countTokens(INGESTION_SYSTEM_PROMPT) + countTokens(renderPromptContext(input));
}

export function splitBatch<T>(batch: T[]): [T[], T[]] {
  const mid = Math.ceil(batch.length / 2);
  return [batch.slice(0, mid), batch.slice(mid)];
}

export function batchRawContent(
  entries: DbRawContent[],
  budgetTokens: number,
): DbRawContent[][] {
  const batches: DbRawContent[][] = [];
  let current: DbRawContent[] = [];
  let currentTokens = 0;
  for (const entry of entries) {
    const size = estimateEntryTokens(entry);
    // Always include at least one entry per batch, even if it alone exceeds the
    // budget: a single long entry must not be split mid-thought, and the
    // split-on-refusal path cannot help a batch of one anyway.
    if (current.length > 0 && currentTokens + size > budgetTokens) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(entry);
    currentTokens += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function completeEmptyIngest(trace: Trace, processingNotes: string): Promise<IngestSummary> {
  const summary: IngestSummary = {
    traceId: trace.id,
    observations_created: 0,
    insights_created: 0,
    goal_candidates_created: 0,
    identity_inferences_created: 0,
    raw_content_processed: 0,
    batches_run: 0,
    user_understanding_version: null,
    cook0_failed: false,
    result: {
      observations: [],
      insights: [],
      goal_candidates: [],
      identity_inferences: [],
    },
    processingNotes,
  };
  await trace.complete();
  return summary;
}

export async function runIngest(options: IngestOptions): Promise<IngestSummary> {
  const daysBack = options.daysBack ?? 7;
  const processingRawContentIds: string[] = [];
  const trace = options.dryRun
    ? Trace.memoryOnly()
    : await Trace.start({
        userId: options.userId,
        kind: 'ingest',
        triggeredBy: options.triggeredBy ?? 'manual',
        notes: options.notes,
      });

  try {
    // 1. Claim the entries this run will read (capture side; claim-work.ts).
    let promoterResult: PromoterRunResult | null = null;
    const claim = await claimWork({
      userId: options.userId,
      daysBack,
      rawContentIds: options.rawContentIds,
      dryRun: options.dryRun,
      force: options.force,
    });
    if (claim.kind === 'empty') return completeEmptyIngest(trace, claim.note);
    const { leasesReclaimed, factsSkippedRows, heartbeat } = claim;
    const newRawContent = claim.rows;
    processingRawContentIds.push(...claim.leasedIds);
    let rawEmbedded = 0;

    // 2. Fetch context (active goals + recent insights + open candidates + latest user understanding)
    const recentInsightsSince = new Date(
      Date.now() - 28 * 24 * 60 * 60 * 1000
    ).toISOString();

    const [goalsRes, insightsRes, candidatesRes, understandingRes] = await Promise.all([
      supabase.from(Tables.GOALS).select('*').eq('user_id', options.userId).eq('is_active', true),
      supabase
        .from(Tables.INSIGHTS)
        .select('*')
        .eq('user_id', options.userId)
        .gte('created_at', recentInsightsSince)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from(Tables.GOAL_CANDIDATES)
        .select('id, title, description')
        .eq('user_id', options.userId)
        .eq('status', 'pending'),
      supabase
        .from(Tables.USER_UNDERSTANDING)
        .select('*')
        .eq('user_id', options.userId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const activeGoals = (goalsRes.data ?? []) as DbGoal[];
    // The only goal ids the model is shown. Any other id it returns is wrong by
    // construction -- see legacy-shim.ts.
    const knownGoalIds = new Set(activeGoals.map((g) => g.id));
    const recentInsights = (insightsRes.data ?? []) as DbInsight[];
    const openGoalCandidates = candidatesRes.data ?? [];
    const currentUnderstanding = (understandingRes.data ?? null) as DbUserUnderstanding | null;
    const currentDocument: UserUnderstandingDocument | null =
      currentUnderstanding?.document ?? null;

    // 3. Snapshot inputs into trace
    if (!options.dryRun) {
      await supabase
        .from(Tables.PIPELINE_RUN_TRACES)
        .update({
          inputs_snapshot: {
            raw_content_ids: newRawContent.map((r) => r.id),
            active_goal_ids: activeGoals.map((g) => g.id),
            recent_insight_ids: recentInsights.map((i) => i.id),
            open_candidate_ids: openGoalCandidates.map((c) => c.id),
            prior_understanding_version: currentUnderstanding?.version ?? null,
            daysBack,
          },
        })
        .eq('id', trace.id!);
    }

    // 4. Batch raw_content to fit OpenAI TPM. Each batch is processed by its
    //    own ingestion-agent call; results are persisted per-batch (since
    //    insight/inference indexes are local to each agent response). Cook 0
    //    runs once at the end with all accumulated new inferences.
    const overheadTokens = measureOverheadTokens({
      recentInsights,
      activeGoals,
      openGoalCandidates,
      currentDocument,
    });
    const budgetTokens = contentTokenBudget(overheadTokens);

    // A queue rather than a fixed list: when the model refuses a batch as too
    // large, that batch is replaced in place by its two halves and the loop
    // picks them up. The budget above should make this rare; the point is that
    // being wrong costs one extra call instead of losing the entries.
    // Facts mode reads one entry per call, exactly as it was measured on the
    // test bank. Packing ~15 entries into one call (sized for the old
    // extractor's input limits) made the facts-only reply run past the output
    // limit and fail on the first batch (18 October 2026).
    const batches = config.extraction.mode === 'legacy'
      ? batchRawContent(newRawContent, budgetTokens)
      : newRawContent.map((rc) => [rc]);
    console.log(
      `[ingest] user=${options.userId} content=${newRawContent.length} batches=${batches.length} ` +
        `overhead=${overheadTokens}tok budget=${budgetTokens}tok`
    );

    const aggregateResult: IngestionResult = {
      observations: [],
      insights: [],
      goal_candidates: [],
      identity_inferences: [],
    };
    const allObservationIds: string[] = [];
    const allInferenceIds: string[] = [];
    let totalInsightsCreated = 0;
    let totalCandidatesCreated = 0;
    const batchNotes: string[] = [];

    let factsWritten = 0;
    let factsDropped = 0;
    const factDropReasons: Record<string, number> = {};
    const selfNamedLoopIds: string[] = [];
    const factWriteErrors: string[] = [];

    let splitCount = 0;

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]!;
      const isDryRun = !!options.dryRun;

      console.log(
        `[ingest]   batch ${batchIdx + 1}/${batches.length}: ${batch.length} entries`
      );

      let result: IngestionResult & { fact_candidates?: unknown[]; processingNotes?: string };
      try {
        result = config.extraction.mode === 'legacy'
          ? await runIngestionAgent({
              newRawContent: batch,
              recentInsights,
              activeGoals,
              openGoalCandidates,
              currentDocument,
              trace,
            })
          : factsOnlyResult(batch, await extractLongEntry(batch, trace));
      } catch (err) {
        // Too large is the one failure we can answer intelligently: halve the
        // batch and try again. Retrying the identical request -- which is what
        // happened before -- can only ever fail identically.
        if (err instanceof RequestTooLargeError && batch.length > 1) {
          const [first, second] = splitBatch(batch);
          batches.splice(batchIdx, 1, first, second);
          splitCount += 1;
          console.warn(
            `[ingest]   batch ${batchIdx + 1} refused as too large — split into ${first.length} + ${second.length}`
          );
          batchIdx -= 1; // reprocess this position, now holding the first half
          continue;
        }
        // A single entry that still will not fit cannot be split further. It is
        // already truncated at the per-entry cap, so this means the cap itself
        // is too high for the account -- worth failing loudly rather than
        // silently dropping the entry.
        throw err;
      }

      aggregateResult.observations.push(...result.observations);
      aggregateResult.insights.push(...result.insights);
      aggregateResult.goal_candidates.push(...result.goal_candidates);
      aggregateResult.identity_inferences.push(...result.identity_inferences);
      if (result.processingNotes) batchNotes.push(result.processingNotes);

      if (isDryRun) continue;

      // 5.0 Facts FIRST. The graph is the bank; observations below are a
      // compatibility shim for Cook A until it reads facts (04, 06).
      // A claim whose quote is not in the source is dropped here and never
      // reaches the graph.
      if ((result.fact_candidates ?? []).length > 0) {
        try {
          const factResult = await writeJournalFacts({
            userId: options.userId,
            candidates: result.fact_candidates ?? [],
            sources: batch.map((rc) => ({
              id: rc.id,
              content: rc.content,
              content_type: rc.content_type,
              content_date: rc.content_date,
            })),
            sourceRunId: trace.id,
            transcriptionConfidence: Object.fromEntries(
              batch
                .map((rc) => {
                  const meta = (rc.metadata ?? {}) as Record<string, unknown>;
                  const c = meta.transcription_confidence;
                  return typeof c === 'number' ? [rc.id, c] : null;
                })
                .filter((e): e is [string, number] => e !== null)
            ),
          });
          factsWritten += factResult.written;
          factsDropped += factResult.dropped;
          for (const [reason, n] of Object.entries(factResult.dropReasons)) {
            factDropReasons[reason] = (factDropReasons[reason] ?? 0) + n;
          }
          selfNamedLoopIds.push(...factResult.selfNamedLoops);
          console.log(
            `[ingest]     facts: ${factResult.written} written, ${factResult.dropped} dropped` +
              (factResult.dropped > 0 ? ` (${JSON.stringify(factResult.dropReasons)})` : '')
          );
        } catch (err) {
          // A graph failure must not lose the batch: observations below still
          // persist, and the origin keys make a retry safe.
          console.error(`[ingest]     facts FAILED: ${(err as Error).message}`);
          factWriteErrors.push((err as Error).message);
        }
      }

      // 5a-d. The old framework's tables (legacy-writes.ts). Writes nothing in facts mode.
      const legacy = await writeLegacyOutputs({
        userId: options.userId,
        batch,
        result,
        knownGoalIds,
        trace,
      });
      allObservationIds.push(...legacy.observationIds);
      allInferenceIds.push(...legacy.inferenceIds);
      totalInsightsCreated += legacy.insightsCreated;
      totalCandidatesCreated += legacy.candidatesCreated;
      batchNotes.push(...legacy.notes);

      // Embed the SOURCE, not just the derived rows. 0.4% of raw_content
      // carried an embedding at audit, which made search_raw_content dead.
      // Facts do not need this to exist; fallback search does.
      try {
        const toEmbed = batch.filter((row) => !row.embedding && row.content?.trim());
        if (toEmbed.length > 0) {
          const vectors = await generateEmbeddings(
            toEmbed.map((row) => row.content.slice(0, 8000))
          );
          trace.addCost({
            embedding_tokens: toEmbed.reduce((acc, r) => acc + r.content.length / 4, 0),
          });
          for (let i = 0; i < toEmbed.length; i++) {
            const vector = vectors[i];
            if (!vector) continue;
            await supabase
              .from(Tables.RAW_CONTENT)
              .update({ embedding: vector })
              .eq('id', toEmbed[i]!.id);
            rawEmbedded += 1;
          }
        }
      } catch (err) {
        // Never fail a batch over search hygiene.
        console.warn(`[ingest]     raw embedding failed: ${(err as Error).message}`);
      }

      const { error: completedError } = await supabase
        .from(Tables.RAW_CONTENT)
        .update({
          processing_status: 'completed',
          processing_error: null,
          processing_started_at: null,
          processed_at: new Date().toISOString(),
        })
        .in('id', batch.map((row) => row.id));
      if (completedError) throw new Error(`Mark raw_content completed failed: ${completedError.message}`);
    } // end batch loop

    if (options.dryRun) {
      // Record what extraction saw before the trace closes. Both exits need it:
      // a dry run is exactly when you most want to know the drop rate.
      trace.setExtractionStats({
        candidates: factsWritten + factsDropped,
        written: factsWritten,
        dropped: factsDropped,
        drop_reasons: factDropReasons,
        rows_seen: newRawContent.length,
        rows_skipped_idempotent: factsSkippedRows,
      });
      await trace.complete();
      return {
        traceId: trace.id,
        observations_created: aggregateResult.observations.length,
        insights_created: aggregateResult.insights.length,
        goal_candidates_created: aggregateResult.goal_candidates.length,
        identity_inferences_created: aggregateResult.identity_inferences.length,
        facts_written: factsWritten,
        leases_reclaimed: leasesReclaimed,
        raw_content_embedded: rawEmbedded,
        patterns_created: 0,
        patterns_promoted: 0,
        whys_created: 0,
        rows_skipped_already_have_facts: factsSkippedRows,
        facts_dropped: factsDropped,
        fact_drop_reasons: factDropReasons,
        self_named_loops: selfNamedLoopIds.length,
        fact_write_errors: factWriteErrors,
        raw_content_processed: newRawContent.length,
        batches_run: batches.length,
        batches_split: splitCount,
        user_understanding_version: null,
        cook0_failed: false,
        result: aggregateResult,
        processingNotes: '[dry-run] nothing written to DB.',
      };
    }

    if (allInferenceIds.length > 0) {
      trace.setIdentityInferenceIds(allInferenceIds);
    }

    // 6. After reading: the old portrait rewrite, then patterns and the
    //    portrait from facts (after-reading.ts).
    const cook0 = await runCook0Step({
      userId: options.userId,
      currentDocument,
      currentVersion: currentUnderstanding?.version ?? 0,
      newInferenceIds: allInferenceIds,
      trace,
    });
    const newUnderstandingVersion = cook0.version;
    const cook0Failed = cook0.failed;
    const cook0Error = cook0.error;
    if (factsWritten > 0 || factsSkippedRows > 0) {
      promoterResult = await consolidateFacts(options.userId, trace);
    }

    heartbeat.stop();
    // Record what extraction saw before the trace closes. Both exits need it:
    // a dry run is exactly when you most want to know the drop rate.
    trace.setExtractionStats({
      candidates: factsWritten + factsDropped,
      written: factsWritten,
      dropped: factsDropped,
      drop_reasons: factDropReasons,
      rows_seen: newRawContent.length,
      rows_skipped_idempotent: factsSkippedRows,
    });
    await trace.complete();

    const processingNotes = [
      batches.length > 1 ? `Processed in ${batches.length} batches (TPM budget).` : null,
      ...batchNotes,
    ]
      .filter(Boolean)
      .join(' ');

    return {
      traceId: trace.id,
      observations_created: allObservationIds.length,
      insights_created: totalInsightsCreated,
      goal_candidates_created: totalCandidatesCreated,
      identity_inferences_created: allInferenceIds.length,
      // Facts are what the product now rests on. A real run used to omit
      // them from its summary -- only the dry-run path reported them -- so a
      // run that wrote 176 facts printed "facts written: 0" (18 October 2026).
      facts_written: factsWritten,
      facts_dropped: factsDropped,
      fact_drop_reasons: factDropReasons,
      rows_skipped_already_have_facts: factsSkippedRows,
      patterns_created: promoterResult?.created ?? 0,
      patterns_promoted: promoterResult?.promoted ?? 0,
      whys_created: promoterResult?.whysCreated ?? 0,
      raw_content_processed: newRawContent.length,
      batches_run: batches.length,
      batches_split: splitCount,
      user_understanding_version: newUnderstandingVersion,
      cook0_failed: cook0Failed,
      cook0_error: cook0Error,
      processingNotes: processingNotes || undefined,
      result: aggregateResult,
    };
  } catch (err) {
    if (!options.dryRun && processingRawContentIds.length > 0) {
      await releaseClaim(processingRawContentIds, err);
    }
    await trace.fail(err);
    throw err;
  }
}

/**
 * The facts-only extractor's output in the shape the rest of ingest expects.
 * The old framework's outputs are empty, so its tables simply stop growing
 * (architecture §6b) while the code that writes them stays in place.
 *
 * Defence in depth on whose words these are: a claim about the user ("Self")
 * from an item not known to be theirs (authorship 'other' or 'unknown') is
 * dropped here even if the model made one. Facts about the item's own
 * subject (Ladder, Farza) are kept.
 */
export function factsOnlyResult(
  batch: Array<{ authorship?: string | null }>,
  candidates: Array<{ subject?: string; source_index?: number }>,
): IngestionResult & { fact_candidates: unknown[] } {
  const kept = candidates.filter((c) => {
    const authorship = batch[Number(c.source_index ?? -1)]?.authorship;
    const notTheirs = authorship === 'other' || authorship === 'unknown';
    return !(notTheirs && /^self$/i.test(String(c.subject ?? '').trim()));
  });
  return { fact_candidates: kept, observations: [], insights: [], goal_candidates: [], identity_inferences: [] } as any;
}

/** Characters of one entry per extraction call. Under the 16,000 the extractor
 *  is shown, with room so a section is never cut by the extractor's own limit. */
export const EXTRACTION_SECTION_CHARS = 12_000;

/**
 * Facts from one entry, however long. An entry over EXTRACTION_SECTION_CHARS is
 * read in sections, one call each, instead of being cut at 16,000 characters --
 * which silently dropped 20,000 characters of a 36,000-character conversation
 * (18 October 2026; Phase 3 item 3.2). Every quote is still checked against the
 * whole entry by writeJournalFacts, so a section boundary cannot produce a
 * quote that is not really there.
 */
export async function extractLongEntry(
  batch: DbRawContent[],
  trace: Trace,
  extract: typeof extractFacts = extractFacts,
): Promise<Awaited<ReturnType<typeof extractFacts>>> {
  const rc = batch[0]!;
  const sections = splitIntoSections(rc.content, EXTRACTION_SECTION_CHARS);
  const out: Awaited<ReturnType<typeof extractFacts>> = [];
  for (const section of sections) {
    const found = await extract({ items: [{ ...rc, content: section }], trace, model: config.extraction.model });
    // One entry per call, so every candidate belongs to source 0.
    out.push(...found.map((c) => ({ ...c, source_index: 0 })));
  }
  return out;
}
