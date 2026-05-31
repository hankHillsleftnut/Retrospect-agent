import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { generateEmbeddings } from '../services/embeddings';
import { runIngestionAgent } from '../agents/ingestion-agent';
import { Trace, TraceTrigger } from './trace';
import type { DbGoal, DbInsight, DbRawContent, IngestionResult } from '../types';

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
  raw_content_processed: number;
  processingNotes?: string;
  result: IngestionResult;
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
        raw_content_processed: 0,
        result: { observations: [], insights: [], goal_candidates: [] },
        processingNotes: 'No new raw content found.',
      };
      await trace.complete();
      return summary;
    }

    // 2. Fetch context (active goals + recent insights + open candidates)
    const recentInsightsSince = new Date(
      Date.now() - 28 * 24 * 60 * 60 * 1000
    ).toISOString();

    const [goalsRes, insightsRes, candidatesRes] = await Promise.all([
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
    ]);

    const activeGoals = (goalsRes.data ?? []) as DbGoal[];
    const recentInsights = (insightsRes.data ?? []) as DbInsight[];
    const openGoalCandidates = candidatesRes.data ?? [];

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
            daysBack,
          },
        })
        .eq('id', trace.id!);
    }

    // 4. Run the ingestion LLM call
    const result = await runIngestionAgent({
      newRawContent,
      recentInsights,
      activeGoals,
      openGoalCandidates,
      trace,
    });

    if (options.dryRun) {
      await trace.complete();
      return {
        traceId: trace.id,
        observations_created: result.observations.length,
        insights_created: result.insights.length,
        goal_candidates_created: result.goal_candidates.length,
        raw_content_processed: newRawContent.length,
        result,
        processingNotes: '[dry-run] nothing written to DB.',
      };
    }

    // 5. Persist observations (and capture their IDs to link insights/candidates)
    const observationIds: string[] = [];
    if (result.observations.length > 0) {
      const toInsert = result.observations.map((o, idx) => {
        const matchedRaw = newRawContent[Math.min(idx, newRawContent.length - 1)];
        return {
          user_id: options.userId,
          goal_id: o.goal_id ?? null,
          raw_content_id: o.raw_content_id ?? matchedRaw?.id ?? null,
          content: o.content,
          reason_why: o.reason_why,
          confidence_score: o.confidence_score,
          observation_date: matchedRaw?.content_date ?? matchedRaw?.created_at ?? new Date().toISOString(),
          is_goal_candidate: o.is_goal_candidate,
          metadata: {},
        };
      });
      const { data: inserted, error: insErr } = await supabase
        .from(Tables.OBSERVATIONS)
        .insert(toInsert)
        .select('id');
      if (insErr) throw new Error(`Insert observations failed: ${insErr.message}`);
      observationIds.push(...(inserted ?? []).map((r) => r.id));

      // Generate embeddings in batch
      const texts = result.observations.map((o) => `${o.content} — ${o.reason_why}`);
      const embeddings = await generateEmbeddings(texts);
      trace.addCost({ embedding_tokens: texts.reduce((acc, t) => acc + t.length / 4, 0) });
      for (let i = 0; i < observationIds.length; i++) {
        const id = observationIds[i];
        const emb = embeddings[i];
        if (id && emb) {
          await supabase.from(Tables.OBSERVATIONS).update({ embedding: emb }).eq('id', id);
        }
      }
    }

    // 6. Persist insights
    let insightsCreated = 0;
    if (result.insights.length > 0) {
      const insightRows = result.insights.map((ins) => {
        const supportingIds = (ins.supporting_observation_indexes ?? [])
          .map((idx) => observationIds[idx])
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
      insightsCreated = insertedInsights?.length ?? 0;

      if (insertedInsights && insertedInsights.length > 0) {
        const texts = insertedInsights.map((i) => `${i.title}\n${i.content}\n${i.evidence_summary}`);
        const embeddings = await generateEmbeddings(texts);
        for (let i = 0; i < insertedInsights.length; i++) {
          await supabase
            .from(Tables.INSIGHTS)
            .update({ embedding: embeddings[i] })
            .eq('id', insertedInsights[i]!.id);
        }
      }
    }

    // 7. Persist goal candidates
    let candidatesCreated = 0;
    if (result.goal_candidates.length > 0) {
      const candidateRows = result.goal_candidates.map((c) => ({
        user_id: options.userId,
        title: c.title,
        description: c.description,
        reasoning: c.reasoning,
        supporting_observation_ids: (c.supporting_observation_indexes ?? [])
          .map((idx) => observationIds[idx])
          .filter(Boolean) as string[],
        confidence_score: c.confidence_score,
        status: 'pending' as const,
      }));
      const { data: insertedCandidates } = await supabase
        .from(Tables.GOAL_CANDIDATES)
        .insert(candidateRows)
        .select('id');
      candidatesCreated = insertedCandidates?.length ?? 0;
    }

    await trace.complete();

    return {
      traceId: trace.id,
      observations_created: observationIds.length,
      insights_created: insightsCreated,
      goal_candidates_created: candidatesCreated,
      raw_content_processed: newRawContent.length,
      processingNotes: result.processingNotes,
      result,
    };
  } catch (err) {
    await trace.fail(err);
    throw err;
  }
}
