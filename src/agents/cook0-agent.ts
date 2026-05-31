import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { claudeJsonCompletion } from '../services/anthropic';
import { config } from '../config';
import { COOK0_SYSTEM_PROMPT } from '../prompts/cook0';
import type { Trace } from '../pipelines/trace';
import type {
  Cook0Result,
  DbGoal,
  DbIdentityInference,
  DbObservation,
  UserUnderstandingDocument,
} from '../types';

interface Cook0Input {
  userId: string;
  currentDocument: UserUnderstandingDocument | null;
  /** Inferences just persisted by the current ingestion run. */
  newInferenceIds: string[];
  trace?: Trace;
  /** Cold-start backfill mode bypasses some safety checks. */
  backfillMode?: boolean;
}

/**
 * Run Cook 0 — produce the next User Understanding Document.
 *
 * Gathers all the inputs Cook 0 needs, calls Claude, returns the structured
 * result. The caller (ingest pipeline) is responsible for applying decisions
 * and writing the new document version. This separation keeps Cook 0 itself
 * pure-ish and easier to test/replay.
 */
export async function runCook0(input: Cook0Input): Promise<Cook0Result> {
  // 1. Pull the inputs Cook 0 needs.
  const recentObsSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const provisionalCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [newInfRes, provisionalRes, recentObsRes, goalsRes, feedbackRes] = await Promise.all([
    input.newInferenceIds.length > 0
      ? supabase
          .from(Tables.IDENTITY_INFERENCES)
          .select('*')
          .in('id', input.newInferenceIds)
      : Promise.resolve({ data: [] as DbIdentityInference[], error: null }),
    supabase
      .from(Tables.IDENTITY_INFERENCES)
      .select('*')
      .eq('user_id', input.userId)
      .eq('is_provisional', true)
      .is('superseded_by', null)
      .is('retired_at', null)
      .gte('created_at', provisionalCutoff)
      .order('created_at', { ascending: true }),
    supabase
      .from(Tables.OBSERVATIONS)
      .select('id, content, observation_date, goal_id, confidence_score')
      .eq('user_id', input.userId)
      .gte('observation_date', recentObsSince)
      .order('observation_date', { ascending: false })
      .limit(80),
    supabase
      .from(Tables.GOALS)
      .select('*')
      .eq('user_id', input.userId)
      .eq('is_active', true),
    supabase
      .from(Tables.EPISODE_FEEDBACK)
      .select('feedback_text, rating, created_at')
      .eq('user_id', input.userId)
      .eq('processed', false)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const newInferences = (newInfRes.data ?? []) as DbIdentityInference[];
  const provisionalInferences = (provisionalRes.data ?? []) as DbIdentityInference[];
  const recentObservations = (recentObsRes.data ?? []) as Pick<
    DbObservation,
    'id' | 'content' | 'observation_date' | 'goal_id' | 'confidence_score'
  >[];
  const activeGoals = (goalsRes.data ?? []) as DbGoal[];
  const unprocessedFeedback = (feedbackRes.data ?? []) as {
    feedback_text: string;
    rating: number | null;
    created_at: string;
  }[];

  // 2. Format inputs for the LLM.
  const priorDocBlock = input.currentDocument
    ? `# PRIOR DOCUMENT (most recent version)
${JSON.stringify(input.currentDocument, null, 2)}`
    : `# PRIOR DOCUMENT
(none — this is a cold start. Generate the first ever document from scratch.)`;

  const newInfBlock = newInferences.length > 0
    ? `# NEW INFERENCES (just produced by ingestion)
${newInferences
  .map(
    (i) =>
      `- id=${i.id} domain=${i.domain}${i.domain_label ? `:${i.domain_label}` : ''} confidence=${i.confidence_score} provisional=${i.is_provisional}
    "${i.content}"
    evidence: ${i.evidence_summary ?? '(none)'}`
  )
  .join('\n')}`
    : `# NEW INFERENCES
(none in this run — re-evaluate provisional inferences and feedback only.)`;

  const provBlock = provisionalInferences.length > 0
    ? `# ACTIVE PROVISIONAL INFERENCES (awaiting promotion or retirement)
${provisionalInferences
  .map((i) => {
    const ageDays = Math.floor(
      (Date.now() - new Date(i.created_at).getTime()) / (24 * 60 * 60 * 1000)
    );
    return `- id=${i.id} age=${ageDays}d domain=${i.domain} confidence=${i.confidence_score}
    "${i.content}"`;
  })
  .join('\n')}`
    : '# ACTIVE PROVISIONAL INFERENCES\n(none)';

  const obsBlock = recentObservations.length > 0
    ? `# RECENT OBSERVATIONS (last 30 days, max 80, newest first)
${recentObservations
  .slice(0, 80)
  .map((o) => `- (${o.observation_date.slice(0, 10)}) ${o.content}`)
  .join('\n')}`
    : '# RECENT OBSERVATIONS\n(none)';

  const goalsBlock = activeGoals.length > 0
    ? `# ACTIVE GOALS
${activeGoals.map((g) => `- [${g.id}] "${g.title}"${g.description ? `: ${g.description}` : ''}`).join('\n')}`
    : '# ACTIVE GOALS\n(none)';

  const feedbackBlock = unprocessedFeedback.length > 0
    ? `# UNPROCESSED EPISODE FEEDBACK
${unprocessedFeedback
  .map(
    (f) =>
      `- (${f.created_at.slice(0, 10)})${f.rating != null ? ` [rating ${f.rating}]` : ''} "${f.feedback_text}"`
  )
  .join('\n')}`
    : '# UNPROCESSED EPISODE FEEDBACK\n(none)';

  const modeBlock = input.backfillMode
    ? `# MODE
Cold-start backfill. The user has months of prior data but no document yet. Generate the first ever document using everything you have. Don't promote or retire anything — there's no prior state to evolve from.`
    : input.currentDocument
      ? '# MODE\nSteady-state update.'
      : '# MODE\nCold start — first ever document for this user.';

  const userMessage = `${modeBlock}

${priorDocBlock}

${newInfBlock}

${provBlock}

${obsBlock}

${goalsBlock}

${feedbackBlock}

Produce the next User Understanding Document. Return STRICT JSON per the schema in your system prompt.`;

  // 3. Call Claude.
  const { data, usage } = await claudeJsonCompletion<Cook0Result>(
    COOK0_SYSTEM_PROMPT,
    userMessage,
    { temperature: 0.4, maxTokens: 8000, model: config.anthropic.cook0Model }
  );

  input.trace?.addCost({
    anthropic_tokens_input: usage.inputTokens,
    anthropic_tokens_output: usage.outputTokens,
  });

  // 4. Defensive normalization — Claude may omit fields under pressure.
  return {
    document: normalizeDocument(data.document),
    generation_notes: data.generation_notes ?? '',
    promote_inference_ids: Array.isArray(data.promote_inference_ids)
      ? data.promote_inference_ids.filter((x) => typeof x === 'string')
      : [],
    retire_inferences: Array.isArray(data.retire_inferences)
      ? data.retire_inferences.filter(
          (r) => r && typeof (r as { id?: unknown }).id === 'string'
        )
      : [],
  };
}

function normalizeDocument(doc: Partial<UserUnderstandingDocument> | undefined): UserUnderstandingDocument {
  return {
    identity_core: typeof doc?.identity_core === 'string' ? doc.identity_core : '',
    active_goals: Array.isArray(doc?.active_goals)
      ? doc.active_goals.map((g) => ({
          goal_id: typeof g?.goal_id === 'string' ? g.goal_id : null,
          title: typeof g?.title === 'string' ? g.title : '',
          what_its_really_about:
            typeof g?.what_its_really_about === 'string' ? g.what_its_really_about : '',
        }))
      : [],
    behavioral_patterns: typeof doc?.behavioral_patterns === 'string' ? doc.behavioral_patterns : '',
    emotional_baseline: typeof doc?.emotional_baseline === 'string' ? doc.emotional_baseline : '',
    live_tensions: Array.isArray(doc?.live_tensions)
      ? doc.live_tensions.filter((t): t is string => typeof t === 'string')
      : [],
    track_record: typeof doc?.track_record === 'string' ? doc.track_record : '',
    forward_focus: typeof doc?.forward_focus === 'string' ? doc.forward_focus : '',
    emerging_dimensions: Array.isArray(doc?.emerging_dimensions)
      ? doc.emerging_dimensions
          .filter((d) => d && typeof (d as { label?: unknown }).label === 'string')
          .map((d) => ({
            label: (d as { label: string }).label,
            content: typeof (d as { content?: unknown }).content === 'string'
              ? (d as { content: string }).content
              : '',
            first_seen_at:
              typeof (d as { first_seen_at?: unknown }).first_seen_at === 'string'
                ? (d as { first_seen_at: string }).first_seen_at
                : new Date().toISOString(),
          }))
      : [],
  };
}

/**
 * Apply Cook 0's lifecycle decisions to the identity_inferences table.
 * Promotion = flip is_provisional false. Retirement = set retired_at + reason
 * (and superseded_by if Cook 0 named a replacement).
 */
export async function applyCook0Decisions(result: Cook0Result): Promise<void> {
  if (result.promote_inference_ids.length > 0) {
    const { error } = await supabase
      .from(Tables.IDENTITY_INFERENCES)
      .update({ is_provisional: false })
      .in('id', result.promote_inference_ids);
    if (error) {
      console.warn(`[cook0] Failed to promote inferences: ${error.message}`);
    }
  }

  for (const r of result.retire_inferences) {
    const { error } = await supabase
      .from(Tables.IDENTITY_INFERENCES)
      .update({
        retired_at: new Date().toISOString(),
        retirement_reason: r.reason,
        superseded_by: r.superseded_by ?? null,
      })
      .eq('id', r.id);
    if (error) {
      console.warn(`[cook0] Failed to retire inference ${r.id}: ${error.message}`);
    }
  }
}

/**
 * Append-only write of a new document version, with optimistic concurrency.
 *
 * Reads the latest version, attempts to insert version = max+1. If two
 * concurrent ingests collide on the unique (user_id, version) index, we
 * retry up to 3 times with a fresh read. Failing that, we surface the error
 * and the caller catches it (Cook 0 wrapping in ingest.ts).
 */
export async function writeNewDocumentVersion(opts: {
  userId: string;
  document: UserUnderstandingDocument;
  generationNotes: string;
  inferenceIdsAtVersion: string[];
  sourceIngestionRunId: string | null;
}): Promise<number> {
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data: latest, error: readErr } = await supabase
      .from(Tables.USER_UNDERSTANDING)
      .select('version')
      .eq('user_id', opts.userId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (readErr) throw new Error(`Read latest version failed: ${readErr.message}`);

    const nextVersion = ((latest?.version as number | undefined) ?? 0) + 1;

    const { error: insErr } = await supabase
      .from(Tables.USER_UNDERSTANDING)
      .insert({
        user_id: opts.userId,
        version: nextVersion,
        document: opts.document,
        inference_ids_at_version: opts.inferenceIdsAtVersion,
        generation_notes: opts.generationNotes,
        source_ingestion_run_id: opts.sourceIngestionRunId,
        model: config.anthropic.cook0Model,
      });

    if (!insErr) return nextVersion;

    // 23505 = unique_violation — a concurrent run grabbed this version.
    if ((insErr as { code?: string }).code === '23505' && attempt < maxAttempts) {
      lastError = insErr;
      continue;
    }
    throw new Error(`Insert user_understanding version failed: ${insErr.message}`);
  }

  throw new Error(
    `writeNewDocumentVersion: exhausted ${maxAttempts} attempts due to concurrent writes. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}
