import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { generateEmbeddings } from '../services/embeddings';
import { runIngestionAgent, contentCharLimit } from '../agents/ingestion-agent';
import { INGESTION_SYSTEM_PROMPT } from '../prompts/ingestion';
import { RequestTooLargeError } from '../services/openai';
import { countTokens, contentTokenBudget } from '../services/token-budget';
import { failureUpdate, MAX_ATTEMPTS } from './retry-policy';
import { writeJournalFacts } from '../brain/write-journal-facts';
import { runPromoter, type PromoterRunResult } from '../brain/run-promoter';
import { buildPortrait, patchDocument } from '../brain/portrait';
import {
  reclaimExpiredLeases,
  reclaimUnstampedLeases,
  startHeartbeat,
  hasExistingFacts,
} from '../brain/lease';
import { runCook0, applyCook0Decisions, writeNewDocumentVersion } from '../agents/cook0-agent';
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

/**
 * How many overdue rows one run may pick up on top of new content.
 *
 * The backlog is thousands of rows. Without a bound, the first run after this
 * ships would try to process all of them at once -- an unbounded spend and a
 * guaranteed rate limit. The queue drains over successive runs instead.
 */
export const RETRY_LIMIT_PER_RUN = Number(process.env.INGEST_RETRY_LIMIT ?? 25);

/** Tokens one entry will actually contribute, measured on the truncated body. */
export function estimateEntryTokens(rc: DbRawContent): number {
  return countTokens(rc.content.slice(0, contentCharLimit(rc.content_type)));
}

/**
 * The fixed cost of a call, measured from the real context about to be sent
 * rather than assumed. Approximate only in that the agent renders these values
 * slightly differently from JSON; it is far closer than the flat 10k guess it
 * replaces, and errs high, which is the safe direction.
 */
export function measureOverheadTokens(input: {
  recentInsights: unknown;
  activeGoals: unknown;
  openGoalCandidates: unknown;
  currentDocument: unknown;
}): number {
  return (
    countTokens(INGESTION_SYSTEM_PROMPT) +
    countTokens(JSON.stringify(input.recentInsights ?? [])) +
    countTokens(JSON.stringify(input.activeGoals ?? [])) +
    countTokens(JSON.stringify(input.openGoalCandidates ?? [])) +
    countTokens(JSON.stringify(input.currentDocument ?? {}))
  );
}

/** Halve a refused batch. Pure, so the arithmetic can be tested on its own. */
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
    // 1. Fetch new raw content
    const sinceIso = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    let leasesReclaimed = 0;
    let factsSkippedRows = 0;
    let rawEmbedded = 0;
    let promoterResult: PromoterRunResult | null = null;
    let heartbeat: { stop: () => void } = { stop: () => {} };

    // Reclaim abandoned work FIRST. A run that died mid-flight leaves its
    // rows in 'processing' forever; without this they are invisible to every
    // later run. This is what turns a transient outage into a retry instead
    // of permanent data loss.
    if (!options.dryRun) {
      const [expired, unstamped] = await Promise.all([
        reclaimExpiredLeases({ userId: options.userId }),
        reclaimUnstampedLeases(options.userId),
      ]);
      const reclaimed = expired.reclaimed + unstamped.reclaimed;
      if (reclaimed > 0) {
        console.log(`[ingest] reclaimed ${reclaimed} abandoned row(s) for retry`);
        leasesReclaimed = reclaimed;
      }
    }

    // Work comes from two places, and conflating them is what made the backlog
    // unreachable.
    //
    //   NEW content is windowed by created_at, because "what has arrived since
    //   I last looked" is genuinely a question about recency.
    //
    //   DUE RETRIES are not windowed at all. A row that failed in March is
    //   still work to do; it does not become less worth processing by getting
    //   older. The previous query applied the seven-day window to both, so any
    //   failure that aged past a week fell off the edge of the world -- which,
    //   with the retry cron disabled, is where two thousand entries went.
    //
    // Retries are bounded per run so that turning this on cannot fire off a
    // two-thousand-row spend in one go. The queue drains over several runs
    // instead, oldest first.
    let newRawContent: DbRawContent[];

    if (options.rawContentIds && options.rawContentIds.length > 0) {
      // Specific IDs requested — fetch them regardless of status or age.
      const { data, error } = await supabase
        .from(Tables.RAW_CONTENT)
        .select('*')
        .eq('user_id', options.userId)
        .in('id', options.rawContentIds);
      if (error) throw new Error(`Fetch raw_content failed: ${error.message}`);
      newRawContent = (data ?? []) as DbRawContent[];
    } else {
      const nowIso = new Date().toISOString();

      const { data: fresh, error: freshErr } = await supabase
        .from(Tables.RAW_CONTENT)
        .select('*')
        .eq('user_id', options.userId)
        .eq('processing_status', 'pending')
        .is('next_attempt_at', null)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true });
      if (freshErr) throw new Error(`Fetch raw_content failed: ${freshErr.message}`);

      const { data: due, error: dueErr } = await supabase
        .from(Tables.RAW_CONTENT)
        .select('*')
        .eq('user_id', options.userId)
        .eq('processing_status', 'pending')
        .not('next_attempt_at', 'is', null)
        .lte('next_attempt_at', nowIso)
        .order('next_attempt_at', { ascending: true })
        .limit(RETRY_LIMIT_PER_RUN);
      if (dueErr) throw new Error(`Fetch due retries failed: ${dueErr.message}`);

      const seen = new Set<string>();
      newRawContent = [...(fresh ?? []), ...(due ?? [])].filter((r) => {
        const row = r as DbRawContent;
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      }) as DbRawContent[];

      if ((due ?? []).length > 0) {
        console.log(`[ingest]   including ${(due ?? []).length} due retries (limit ${RETRY_LIMIT_PER_RUN})`);
      }
    }

    if (newRawContent.length === 0) {
      return completeEmptyIngest(trace, 'No new raw content found.');
    }

    if (!options.dryRun) {
      const ids = newRawContent.map((row) => row.id);
      const leaseStartedAt = new Date().toISOString();
      let leaseQuery = supabase
        .from(Tables.RAW_CONTENT)
        .update({
          processing_status: 'processing',
          processing_error: null,
          processing_started_at: leaseStartedAt,
        })
        .in('id', ids);
      if (!options.force) {
        leaseQuery = leaseQuery.in('processing_status', ['pending', 'failed']);
      }
      const { data: leasedRows, error: processingError } = await leaseQuery.select('*');
      if (processingError) throw new Error(`Mark raw_content processing failed: ${processingError.message}`);
      newRawContent = (leasedRows ?? []) as DbRawContent[];

      // Idempotency: a row that already produced Facts does not need the LLM
      // again. Origin keys mean a re-extract would upsert to the same rows,
      // so this is purely saved spend -- and it makes retry cheap enough to
      // be the default response to a failure.
      if (!options.force && newRawContent.length > 0) {
        const checks = await Promise.all(
          newRawContent.map(async (row) => ({
            row,
            done: await hasExistingFacts(options.userId, row.id),
          }))
        );
        const already = checks.filter((c) => c.done).map((c) => c.row.id);
        if (already.length > 0) {
          await supabase
            .from(Tables.RAW_CONTENT)
            .update({
              processing_status: 'completed',
              processing_started_at: null,
              processed_at: new Date().toISOString(),
            })
            .in('id', already);
          factsSkippedRows = already.length;
          console.log(`[ingest] ${already.length} row(s) already have facts; skipping extraction`);
          newRawContent = checks.filter((c) => !c.done).map((c) => c.row);
        }
        if (newRawContent.length === 0) {
          return completeEmptyIngest(trace, 'All requested rows already produced facts.');
        }
      }

      processingRawContentIds.push(...newRawContent.map((row) => row.id));
      heartbeat = startHeartbeat(processingRawContentIds);
      if (newRawContent.length === 0) {
        return completeEmptyIngest(trace, 'No raw content was eligible for processing; another run may hold the lease.');
      }
    }

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
    const batches = batchRawContent(newRawContent, budgetTokens);
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
        result = await runIngestionAgent({
          newRawContent: batch,
          recentInsights,
          activeGoals,
          openGoalCandidates,
          currentDocument,
          trace,
        });
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

      // 5a. Persist observations from this batch.
      const batchObservationIds: string[] = [];
      if (result.observations.length > 0) {
        const toInsert = result.observations.map((o) => {
          const citedRawIds = [...new Set(
            (o.supporting_raw_content_indexes ?? [])
              .map((idx) => batch[idx]?.id)
              .filter((id): id is string => Boolean(id))
          )];
          const supportingRawIds =
            citedRawIds.length > 0
              ? citedRawIds
              : batch.length === 1
                ? [batch[0]!.id]
                : [];
          const matchedRaw = batch.find((raw) => raw.id === supportingRawIds[0]);
          return {
            user_id: options.userId,
            goal_id: o.goal_id ?? null,
            raw_content_id: supportingRawIds[0] ?? null,
            content: o.content,
            reason_why: o.reason_why,
            confidence_score: o.confidence_score,
            observation_date:
              matchedRaw?.content_date ?? matchedRaw?.created_at ?? new Date().toISOString(),
            is_goal_candidate: o.is_goal_candidate,
            metadata: { supporting_raw_content_ids: supportingRawIds },
          };
        });
        const { data: inserted, error: insErr } = await supabase
          .from(Tables.OBSERVATIONS)
          .insert(toInsert)
          .select('id');
        if (insErr) throw new Error(`Insert observations failed: ${insErr.message}`);
        batchObservationIds.push(...(inserted ?? []).map((r) => r.id));

        const texts = result.observations.map((o) => `${o.content} — ${o.reason_why}`);
        const embeddings = await generateEmbeddings(texts);
        trace.addCost({ embedding_tokens: texts.reduce((acc, t) => acc + t.length / 4, 0) });
        for (let i = 0; i < batchObservationIds.length; i++) {
          const id = batchObservationIds[i];
          const emb = embeddings[i];
          if (id && emb) {
            await supabase.from(Tables.OBSERVATIONS).update({ embedding: emb }).eq('id', id);
          }
        }
        allObservationIds.push(...batchObservationIds);
      }

      // 5b. Persist insights from this batch (indexes are local to the batch's response).
      if (result.insights.length > 0) {
        const insightRows = result.insights.map((ins) => {
          const supportingIds = (ins.supporting_observation_indexes ?? [])
            .map((idx) => batchObservationIds[idx])
            .filter(Boolean) as string[];
          return {
            user_id: options.userId,
            goal_id: ins.goal_id,
            title: ins.title,
            content: ins.content,
            evidence_summary: ins.evidence_summary,
            supporting_observation_ids: supportingIds,
            confidence_score: ins.confidence_score,
            metadata: {},
          };
        });
        const { data: insertedInsights, error: insightErr } = await supabase
          .from(Tables.INSIGHTS)
          .insert(insightRows)
          .select('id, title, content, evidence_summary');
        if (insightErr) throw new Error(`Insert insights failed: ${insightErr.message}`);
        totalInsightsCreated += insertedInsights?.length ?? 0;

        if (insertedInsights && insertedInsights.length > 0) {
          const texts = insertedInsights.map(
            (i) => `${i.title}\n${i.content}\n${i.evidence_summary}`
          );
          const embeddings = await generateEmbeddings(texts);
          for (let i = 0; i < insertedInsights.length; i++) {
            await supabase
              .from(Tables.INSIGHTS)
              .update({ embedding: embeddings[i] })
              .eq('id', insertedInsights[i]!.id);
          }
        }
      }

      // 5c. Persist goal candidates from this batch.
      if (result.goal_candidates.length > 0) {
        const candidateRows = result.goal_candidates.map((c) => ({
          user_id: options.userId,
          title: c.title,
          description: c.description,
          reasoning: c.reasoning,
          supporting_observation_ids: (c.supporting_observation_indexes ?? [])
            .map((idx) => batchObservationIds[idx])
            .filter(Boolean) as string[],
          confidence_score: c.confidence_score,
          status: 'pending' as const,
        }));
        const { data: insertedCandidates } = await supabase
          .from(Tables.GOAL_CANDIDATES)
          .insert(candidateRows)
          .select('id');
        totalCandidatesCreated += insertedCandidates?.length ?? 0;
      }

      // 5d. Persist identity inferences from this batch (raw_content indexes are local).
      if (result.identity_inferences.length > 0) {
        const inferenceRows = result.identity_inferences.map((inf) => {
          const rawIds = (inf.supporting_raw_content_indexes ?? [])
            .map((idx) => batch[idx]?.id)
            .filter((x): x is string => Boolean(x));
          const obsIds = (inf.supporting_observation_indexes ?? [])
            .map((idx) => batchObservationIds[idx])
            .filter((x): x is string => Boolean(x));
          return {
            user_id: options.userId,
            content: inf.content,
            domain: inf.domain,
            domain_label: inf.domain === 'emerging' ? (inf.domain_label ?? null) : null,
            confidence_score: inf.confidence_score,
            is_provisional: inf.is_provisional,
            evidence_summary: inf.evidence_summary ?? null,
            supporting_raw_content_ids: rawIds,
            supporting_observation_ids: obsIds,
            source_ingestion_run_id: trace.id,
          };
        });

        const { data: insertedInferences, error: infErr } = await supabase
          .from(Tables.IDENTITY_INFERENCES)
          .insert(inferenceRows)
          .select('id');
        if (infErr) throw new Error(`Insert identity_inferences failed: ${infErr.message}`);
        const batchInferenceIds = (insertedInferences ?? []).map((r) => r.id);
        allInferenceIds.push(...batchInferenceIds);

        const texts = result.identity_inferences.map(
          (inf) => `${inf.content}${inf.evidence_summary ? ` — ${inf.evidence_summary}` : ''}`
        );
        const embeddings = await generateEmbeddings(texts);
        trace.addCost({ embedding_tokens: texts.reduce((acc, t) => acc + t.length / 4, 0) });
        for (let i = 0; i < batchInferenceIds.length; i++) {
          const id = batchInferenceIds[i];
          const emb = embeddings[i];
          if (id && emb) {
            await supabase.from(Tables.IDENTITY_INFERENCES).update({ embedding: emb }).eq('id', id);
          }
        }
      }

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
        user_understanding_version: null,
        cook0_failed: false,
        result: aggregateResult,
        processingNotes: '[dry-run] nothing written to DB.',
      };
    }

    if (allInferenceIds.length > 0) {
      trace.setIdentityInferenceIds(allInferenceIds);
    }

    // 6. Cook 0 — rewrite the User Understanding Document.
    //    Wrapped in its own try/catch so a Cook 0 failure does NOT undo
    //    observations/insights/inferences. The document just stays at its
    //    previous version and we record the failure on the trace.
    let newUnderstandingVersion: number | null = null;
    let cook0Failed = false;
    let cook0Error: string | undefined;

    try {
      const cook0Result = await runCook0({
        userId: options.userId,
        currentDocument,
        newInferenceIds: allInferenceIds,
        trace,
      });

      await applyCook0Decisions(cook0Result);

      const { data: activeRows } = await supabase
        .from(Tables.IDENTITY_INFERENCES)
        .select('id')
        .eq('user_id', options.userId)
        .is('superseded_by', null)
        .is('retired_at', null);
      const activeInferenceIds = (activeRows ?? []).map((r) => r.id);

      newUnderstandingVersion = await writeNewDocumentVersion({
        userId: options.userId,
        document: cook0Result.document,
        generationNotes: cook0Result.generation_notes,
        inferenceIdsAtVersion: activeInferenceIds,
        sourceIngestionRunId: trace.id,
      });

      trace.setUserUnderstanding(cook0Result.document, newUnderstandingVersion);
    } catch (err) {
      cook0Failed = true;
      cook0Error = err instanceof Error ? err.message : String(err);
      console.warn(
        `[ingest] Cook 0 failed for user ${options.userId}: ${cook0Error}. ` +
          `Observations/insights/inferences were persisted; document stays at v${currentUnderstanding?.version ?? 0}.`
      );
      trace.setCook0Failure(cook0Error);
    }

    // Patterns, then whys, then the portrait -- in that order, because each
    // can only exist once the one before it does.
    if (factsWritten > 0 || factsSkippedRows > 0) {
      try {
        promoterResult = await runPromoter({ userId: options.userId, sourceRunId: trace.id });
        console.log(
          `[ingest] patterns: ${promoterResult.created} new, ${promoterResult.promoted} promoted, ` +
            `${promoterResult.demoted} demoted, ${promoterResult.whysCreated} whys`
        );
      } catch (err) {
        // Facts are already safe; a promoter failure costs this run's patterns,
        // not the evidence. The next run recomputes from the same facts.
        console.error(`[ingest] promoter FAILED: ${(err as Error).message}`);
      }

      try {
        const portrait = await buildPortrait(options.userId);
        const { data: latest } = await supabase.from(Tables.USER_UNDERSTANDING)
          .select('document,version').eq('user_id', options.userId)
          .order('version', { ascending: false }).limit(1).maybeSingle();
        const patched = patchDocument((latest?.document as any) ?? null, portrait);
        await supabase.from(Tables.USER_UNDERSTANDING).upsert({
          user_id: options.userId,
          document: patched,
          version: (latest?.version ?? 0) + 1,
        });
        console.log(`[ingest] portrait rebuilt (${portrait.emptySlots.length} slot(s) left empty)`);
      } catch (err) {
        console.error(`[ingest] portrait rebuild FAILED: ${(err as Error).message}`);
      }
    }

    heartbeat.stop();
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
      raw_content_processed: newRawContent.length,
      batches_run: batches.length,
      user_understanding_version: newUnderstandingVersion,
      cook0_failed: cook0Failed,
      cook0_error: cook0Error,
      processingNotes: processingNotes || undefined,
      result: aggregateResult,
    };
  } catch (err) {
    if (!options.dryRun && processingRawContentIds.length > 0) {
      // A failure is a scheduling decision now, not a verdict.
      //
      // This used to write `failed` on every row in flight, whatever had gone
      // wrong. A rate limit lasting ninety seconds and a genuinely
      // unprocessable entry were recorded identically, and nothing ever looked
      // at either again. Rows still worth retrying go back to `pending` with a
      // due time; only rows that are out of attempts, or whose failure cannot
      // be fixed by trying again, keep the word `failed`.
      const message = err instanceof Error ? err.message : String(err);

      const { data: rows } = await supabase
        .from(Tables.RAW_CONTENT)
        .select('id, attempt_count')
        .in('id', processingRawContentIds)
        .eq('processing_status', 'processing');

      // Rows sharing an attempt count share an update, so this is one or two
      // statements in practice rather than one per row.
      const byAttempt = new Map<number, string[]>();
      for (const row of (rows ?? []) as { id: string; attempt_count: number | null }[]) {
        const n = row.attempt_count ?? 0;
        if (!byAttempt.has(n)) byAttempt.set(n, []);
        byAttempt.get(n)!.push(row.id);
      }

      for (const [attempts, ids] of byAttempt) {
        const update = failureUpdate(message, attempts);
        await supabase
          .from(Tables.RAW_CONTENT)
          .update({ ...update, processing_started_at: null })
          .in('id', ids)
          .eq('processing_status', 'processing');

        console.warn(
          `[ingest]   ${ids.length} row(s) -> ${update.processing_status}` +
            ` (attempt ${update.attempt_count}/${MAX_ATTEMPTS}, ${update.failure_kind}` +
            `${update.next_attempt_at ? `, due ${update.next_attempt_at}` : ', no further attempts'})`
        );
      }
    }
    await trace.fail(err);
    throw err;
  }
}
