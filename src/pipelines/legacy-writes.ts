/**
 * The old framework's outputs: observations, insights, goal candidates and
 * identity inferences, written from a legacy extractor reply.
 *
 * Kept whole and separate so it can be disconnected in one place
 * (architecture-and-sequence §6b). In facts mode the extractor returns none of
 * these, so this writes nothing. Moved out of runIngest unchanged.
 *
 * Never allowed to fail the run: a failed insert is recorded in `notes`.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { generateEmbeddings } from '../services/embeddings';
import { legacyGoalIdOrDrop, sanitizeGoalId } from './legacy-shim';
import type { Trace } from './trace';
import type { DbRawContent, IngestionResult } from '../types';

export interface LegacyWriteResult {
  observationIds: string[];
  inferenceIds: string[];
  insightsCreated: number;
  candidatesCreated: number;
  notes: string[];
}

export async function writeLegacyOutputs(input: {
  userId: string;
  batch: DbRawContent[];
  result: IngestionResult;
  /** The only goal ids the model was shown; see legacy-shim.ts. */
  knownGoalIds: Set<string>;
  trace: Trace;
}): Promise<LegacyWriteResult> {
  const { userId, batch, result, knownGoalIds, trace } = input;
  const observationIds: string[] = [];
  const inferenceIds: string[] = [];
  let insightsCreated = 0;
  let candidatesCreated = 0;
  const notes: string[] = [];

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
        user_id: userId,
        goal_id: sanitizeGoalId(o.goal_id, knownGoalIds),
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
    if (insErr) {
      // Legacy table: never allowed to fail the run. The facts for this
      // batch are already written. Recorded, not swallowed.
      notes.push(`legacy observations not written: ${insErr.message}`);
      console.error(`[ingest]     legacy observations FAILED (run continues): ${insErr.message}`);
    } else {
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
      observationIds.push(...batchObservationIds);
    }
  }

  // 5b. Persist insights from this batch (indexes are local to the batch's response).
  if (result.insights.length > 0) {
    let insightsDroppedForGoal = 0;
    const insightRows = result.insights.flatMap((ins) => {
      // insights.goal_id is NOT NULL, so an insight citing a goal the model
      // was never shown cannot be stored at all. Drop it rather than let the
      // insert fail. See legacy-shim.ts.
      const goal = legacyGoalIdOrDrop('insights', ins.goal_id, knownGoalIds);
      if (!goal.keep) {
        insightsDroppedForGoal += 1;
        return [];
      }
      const supportingIds = (ins.supporting_observation_indexes ?? [])
        .map((idx) => batchObservationIds[idx])
        .filter(Boolean) as string[];
      return [{
        user_id: userId,
        goal_id: goal.goalId,
        title: ins.title,
        content: ins.content,
        evidence_summary: ins.evidence_summary,
        supporting_observation_ids: supportingIds,
        confidence_score: ins.confidence_score,
        metadata: {},
      }];
    });
    if (insightsDroppedForGoal > 0) {
      notes.push(`legacy insights dropped (goal not among those shown): ${insightsDroppedForGoal}`);
    }
    const { data: insertedInsights, error: insightErr } = insightRows.length > 0
      ? await supabase
          .from(Tables.INSIGHTS)
          .insert(insightRows)
          .select('id, title, content, evidence_summary')
      : { data: [], error: null };
    if (insightErr) {
      // Legacy table: never allowed to fail the run.
      notes.push(`legacy insights not written: ${insightErr.message}`);
      console.error(`[ingest]     legacy insights FAILED (run continues): ${insightErr.message}`);
    }
    insightsCreated += insertedInsights?.length ?? 0;

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
      user_id: userId,
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
    candidatesCreated += insertedCandidates?.length ?? 0;
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
        user_id: userId,
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
    if (infErr) {
      // Legacy table: never allowed to fail the run.
      notes.push(`legacy identity_inferences not written: ${infErr.message}`);
      console.error(`[ingest]     legacy identity_inferences FAILED (run continues): ${infErr.message}`);
    }
    const batchInferenceIds = (insertedInferences ?? []).map((r) => r.id);
    inferenceIds.push(...batchInferenceIds);

    // Only embed what was stored -- a failed insert should not still pay for
    // embeddings of rows that do not exist.
    if (batchInferenceIds.length > 0) {
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
  }

  return { observationIds, inferenceIds, insightsCreated, candidatesCreated, notes };
}
