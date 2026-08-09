import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { materializeIdentityHypothesis } from './graph-v2';

interface DerivedRow {
  id: string;
  confidence_score: number | null;
  supporting_observation_ids?: string[] | null;
  supporting_raw_content_ids?: string[] | null;
  raw_content_id?: string | null;
  goal_id?: string | null;
  metadata?: Record<string, unknown> | null;
  content?: string;
  domain?: string;
}

function uniqueIds(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export async function linkIntegrationEvidence(
  userId: string,
  rawContentIds: string[],
  sourceRunId: string | null
): Promise<{ evidenceLinks: number; graphEdges: number }> {
  const inputRawIds = uniqueIds(rawContentIds);
  if (inputRawIds.length === 0) return { evidenceLinks: 0, graphEdges: 0 };

  const { data: rawRows, error: rawError } = await supabase
    .from(Tables.RAW_CONTENT)
    .select('id, source_item_id')
    .eq('user_id', userId)
    .in('id', inputRawIds);
  if (rawError) throw new Error(`Fetch raw content provenance failed: ${rawError.message}`);

  const rawToSource = new Map<string, string>();
  for (const row of rawRows ?? []) {
    if (row.source_item_id) rawToSource.set(row.id, row.source_item_id);
  }
  if (rawToSource.size === 0) return { evidenceLinks: 0, graphEdges: 0 };

  const { data: unitRows, error: unitError } = await supabase
    .from(Tables.ANALYSIS_UNITS)
    .select('id, source_item_id')
    .eq('user_id', userId)
    .in('source_item_id', uniqueIds([...rawToSource.values()]));
  if (unitError) throw new Error(`Fetch analysis units failed: ${unitError.message}`);

  const unitsBySource = new Map<string, string[]>();
  for (const unit of unitRows ?? []) {
    unitsBySource.set(unit.source_item_id, [...(unitsBySource.get(unit.source_item_id) ?? []), unit.id]);
  }
  const unitsForRaw = (ids: string[]) => uniqueIds(
    ids.flatMap((rawId) => unitsBySource.get(rawToSource.get(rawId) ?? '') ?? [])
  );

  const { data: observationData, error: observationError } = await supabase
    .from(Tables.OBSERVATIONS)
    .select('id, raw_content_id, goal_id, confidence_score, metadata')
    .eq('user_id', userId)
    .in('raw_content_id', inputRawIds);
  if (observationError) throw new Error(`Fetch observations for provenance failed: ${observationError.message}`);
  const observations = (observationData ?? []) as DerivedRow[];
  const observationIds = observations.map((row) => row.id);

  const [insightResult, candidateResult, inferenceResult] = await Promise.all([
    observationIds.length > 0
      ? supabase
          .from(Tables.INSIGHTS)
          .select('id, goal_id, confidence_score, supporting_observation_ids')
          .eq('user_id', userId)
          .overlaps('supporting_observation_ids', observationIds)
      : Promise.resolve({ data: [], error: null }),
    observationIds.length > 0
      ? supabase
          .from(Tables.GOAL_CANDIDATES)
          .select('id, confidence_score, supporting_observation_ids')
          .eq('user_id', userId)
          .overlaps('supporting_observation_ids', observationIds)
      : Promise.resolve({ data: [], error: null }),
    sourceRunId
      ? supabase
          .from(Tables.IDENTITY_INFERENCES)
          .select('id, content, domain, confidence_score, supporting_raw_content_ids, supporting_observation_ids')
          .eq('user_id', userId)
          .eq('source_ingestion_run_id', sourceRunId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (insightResult.error) throw new Error(`Fetch integration insights failed: ${insightResult.error.message}`);
  if (candidateResult.error) throw new Error(`Fetch integration goal candidates failed: ${candidateResult.error.message}`);
  if (inferenceResult.error) throw new Error(`Fetch integration identity inferences failed: ${inferenceResult.error.message}`);

  const insights = (insightResult.data ?? []) as DerivedRow[];
  const candidates = (candidateResult.data ?? []) as DerivedRow[];
  const inferences = (inferenceResult.data ?? []) as DerivedRow[];
  const observationById = new Map(observations.map((row) => [row.id, row]));
  const inputRawSet = new Set(inputRawIds);

  const observationRawIds = (observation: DerivedRow) => {
    const metadataIds = Array.isArray(observation.metadata?.supporting_raw_content_ids)
      ? observation.metadata.supporting_raw_content_ids.filter((id): id is string => typeof id === 'string')
      : [];
    return uniqueIds([observation.raw_content_id, ...metadataIds]).filter((id) => inputRawSet.has(id));
  };
  const rawIdsForObservations = (ids: string[] | null | undefined) => uniqueIds(
    (ids ?? []).flatMap((id) => {
      const observation = observationById.get(id);
      return observation ? observationRawIds(observation) : [];
    })
  );

  const evidenceByKey = new Map<string, Record<string, unknown>>();
  const graphByKey = new Map<string, Record<string, unknown>>();
  const addEvidence = (
    derivedType: string,
    derivedId: string,
    rawIds: string[],
    confidence: number | null,
    relationship = 'evidence_for'
  ) => {
    for (const analysisUnitId of unitsForRaw(rawIds)) {
      const key = `${analysisUnitId}:${derivedType}:${derivedId}:${relationship}`;
      evidenceByKey.set(key, {
        user_id: userId,
        analysis_unit_id: analysisUnitId,
        derived_type: derivedType,
        derived_id: derivedId,
        relationship,
        confidence,
        ...(sourceRunId ? { source_run_id: sourceRunId } : {}),
        metadata: { raw_content_ids: rawIds },
      });
    }
  };
  const addGraph = (
    fromType: string,
    fromId: string,
    toType: string,
    toId: string,
    edgeType: string,
    weight: number | null,
    metadata: Record<string, unknown> = {}
  ) => {
    const key = `${fromType}:${fromId}:${toType}:${toId}:${edgeType}`;
    graphByKey.set(key, {
      user_id: userId,
      from_type: fromType,
      from_id: fromId,
      to_type: toType,
      to_id: toId,
      edge_type: edgeType,
      weight,
      source_run_id: sourceRunId,
      metadata,
    });
  };

  for (const observation of observations) {
    const rawIds = observationRawIds(observation);
    addEvidence('observation', observation.id, rawIds, observation.confidence_score);
    for (const rawId of rawIds) {
      addGraph('observation', observation.id, 'raw_content', rawId, 'derived_from', observation.confidence_score);
    }
    if (observation.goal_id) {
      addGraph('observation', observation.id, 'goal', observation.goal_id, 'relates_to_goal', observation.confidence_score);
    }
  }

  for (const insight of insights) {
    const rawIds = rawIdsForObservations(insight.supporting_observation_ids);
    addEvidence('insight', insight.id, rawIds, insight.confidence_score);
    for (const observationId of insight.supporting_observation_ids ?? []) {
      addGraph('insight', insight.id, 'observation', observationId, 'evidence_for', insight.confidence_score);
    }
    if (insight.goal_id) {
      addGraph('insight', insight.id, 'goal', insight.goal_id, 'relates_to_goal', insight.confidence_score);
    }
  }

  for (const candidate of candidates) {
    const rawIds = rawIdsForObservations(candidate.supporting_observation_ids);
    addEvidence('goal_candidate', candidate.id, rawIds, candidate.confidence_score);
    for (const observationId of candidate.supporting_observation_ids ?? []) {
      addGraph('goal_candidate', candidate.id, 'observation', observationId, 'evidence_for', candidate.confidence_score);
    }
  }

  for (const inference of inferences) {
    const rawIds = uniqueIds([
      ...(inference.supporting_raw_content_ids ?? []).filter((id) => inputRawSet.has(id)),
      ...rawIdsForObservations(inference.supporting_observation_ids),
    ]);
    addEvidence('identity_inference', inference.id, rawIds, inference.confidence_score);
    for (const rawId of rawIds) {
      addGraph('identity_inference', inference.id, 'raw_content', rawId, 'evidence_for', inference.confidence_score);
    }
    for (const observationId of inference.supporting_observation_ids ?? []) {
      addGraph('identity_inference', inference.id, 'observation', observationId, 'evidence_for', inference.confidence_score);
    }
    if (inference.content) {
      await materializeIdentityHypothesis({
        userId,
        inferenceId: inference.id,
        content: inference.content,
        domain: inference.domain,
        confidence: inference.confidence_score ?? 0.5,
        rawContentIds: rawIds,
      });
    }
  }

  const evidenceRows = [...evidenceByKey.values()];
  if (evidenceRows.length > 0) {
    const { error } = await supabase
      .from(Tables.EVIDENCE_LINKS)
      .upsert(evidenceRows, { onConflict: 'analysis_unit_id,derived_type,derived_id,relationship' });
    if (error) throw new Error(`Write evidence links failed: ${error.message}`);
  }

  const graphRows = [...graphByKey.values()];
  let insertedGraphEdges = 0;
  if (graphRows.length > 0) {
    const { data: existing, error: existingError } = await supabase
      .from(Tables.GRAPH_EDGES)
      .select('from_type, from_id, to_type, to_id, edge_type')
      .eq('user_id', userId)
      .in('from_id', uniqueIds(graphRows.map((row) => row.from_id as string)))
      .is('superseded_by', null)
      .is('retired_at', null);
    if (existingError) throw new Error(`Fetch graph edges failed: ${existingError.message}`);

    const existingKeys = new Set((existing ?? []).map(
      (edge) => `${edge.from_type}:${edge.from_id}:${edge.to_type}:${edge.to_id}:${edge.edge_type}`
    ));
    const newGraphRows = graphRows.filter((row) => !existingKeys.has(
      `${row.from_type}:${row.from_id}:${row.to_type}:${row.to_id}:${row.edge_type}`
    ));
    if (newGraphRows.length > 0) {
      const { error } = await supabase.from(Tables.GRAPH_EDGES).insert(newGraphRows);
      if (error) throw new Error(`Write graph edges failed: ${error.message}`);
      insertedGraphEdges = newGraphRows.length;
    }
  }

  return { evidenceLinks: evidenceRows.length, graphEdges: insertedGraphEdges };
}
