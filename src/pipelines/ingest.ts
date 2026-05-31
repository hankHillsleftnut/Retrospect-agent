import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { generateEmbeddings } from '../services/embeddings';
import { runIngestionAgent } from '../agents/ingestion-agent';
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
  notes?: string;
}

export interface IngestSummary {
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
 * Soft cap on the raw_content character budget per ingestion-agent call.
 * Conservative against OpenAI Tier-1 TPM (30K tokens/min). With ~10K tokens
 * of overhead (system prompt + document block + goals/insights/candidates),
 * that leaves ~20K input tokens for the raw_content blocks themselves.
 * 35000 chars ≈ 9K tokens, fits comfortably.
 */
const MAX_BATCH_CHARS = 35000;

/** Per-entry content cap (matches the slice in ingestion-agent.ts). */
function estimateEntryChars(rc: DbRawContent): number {
  const cap = rc.content_type === 'onboarding_profile' ? 10000 : 4000;
  return Math.min(rc.content.length, cap);
}

function batchRawContent(entries: DbRawContent[]): DbRawContent[][] {
  const batches: DbRawContent[][] = [];
  let current: DbRawContent[] = [];
  let currentChars = 0;
  for (const entry of entries) {
    const size = estimateEntryChars(entry);
    // Always include at least one entry per batch, even if it alone exceeds the cap.
    if (current.length > 0 && currentChars + size > MAX_BATCH_CHARS) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(entry);
    currentChars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export async function runIngest(options: IngestOptions): Promise<IngestSummary> {
  const daysBack = options.daysBack ?? 7;
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
    // Only pick up content that hasn't been successfully processed yet.
    // This prevents creating duplicate observations when re-running ingestion.
    let rawQuery = supabase
      .from(Tables.RAW_CONTENT)
      .select('*')
      .eq('user_id', options.userId)
      .in('processing_status', ['pending', 'failed'])
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true });

    if (options.rawContentIds && options.rawContentIds.length > 0) {
      // Specific IDs requested — fetch them regardless of status
      rawQuery = supabase
        .from(Tables.RAW_CONTENT)
        .select('*')
        .eq('user_id', options.userId)
        .in('id', options.rawContentIds);
    }

    const { data: rawData, error: rawErr } = await rawQuery;
    if (rawErr) throw new Error(`Fetch raw_content failed: ${rawErr.message}`);
    const newRawContent = (rawData ?? []) as DbRawContent[];

    if (newRawContent.length === 0) {
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
        processingNotes: 'No new raw content found.',
      };
      await trace.complete();
      return summary;
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
    const batches = batchRawContent(newRawContent);
    console.log(
      `[ingest] user=${options.userId} content=${newRawContent.length} batches=${batches.length}`
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

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]!;
      const isDryRun = !!options.dryRun;

      console.log(
        `[ingest]   batch ${batchIdx + 1}/${batches.length}: ${batch.length} entries`
      );

      const result = await runIngestionAgent({
        newRawContent: batch,
        recentInsights,
        activeGoals,
        openGoalCandidates,
        currentDocument,
        trace,
      });

      aggregateResult.observations.push(...result.observations);
      aggregateResult.insights.push(...result.insights);
      aggregateResult.goal_candidates.push(...result.goal_candidates);
      aggregateResult.identity_inferences.push(...result.identity_inferences);
      if (result.processingNotes) batchNotes.push(result.processingNotes);

      if (isDryRun) continue;

      // 5a. Persist observations from this batch.
      const batchObservationIds: string[] = [];
      if (result.observations.length > 0) {
        const toInsert = result.observations.map((o, idx) => {
          const matchedRaw = batch[Math.min(idx, batch.length - 1)];
          return {
            user_id: options.userId,
            goal_id: o.goal_id ?? null,
            raw_content_id: o.raw_content_id ?? matchedRaw?.id ?? null,
            content: o.content,
            reason_why: o.reason_why,
            confidence_score: o.confidence_score,
            observation_date:
              matchedRaw?.content_date ?? matchedRaw?.created_at ?? new Date().toISOString(),
            is_goal_candidate: o.is_goal_candidate,
            metadata: {},
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
    } // end batch loop

    if (options.dryRun) {
      await trace.complete();
      return {
        traceId: trace.id,
        observations_created: aggregateResult.observations.length,
        insights_created: aggregateResult.insights.length,
        goal_candidates_created: aggregateResult.goal_candidates.length,
        identity_inferences_created: aggregateResult.identity_inferences.length,
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
    await trace.fail(err);
    throw err;
  }
}
