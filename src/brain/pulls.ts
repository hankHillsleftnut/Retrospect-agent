/**
 * Typed pulls -- the read API for the bank.
 *
 * Named questions with exact answers, not one embedding and a hope. This is
 * the boundary between the brain and everything that consumes it: once these
 * exist, how facts are stored can change without touching a single cook.
 *
 * Validity is filtered IN SQL. Cook B's existing bug is that it filters dates
 * in JavaScript after the query returns, which yields the right answer for the
 * wrong reason and stays slow forever.
 *
 * docs/second-brain/04 "Typed pulls", 01 Example E.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export interface FactRow {
  id: string;
  predicate: string;
  subject_entity_id: string;
  object_entity_id: string | null;
  object_value: Record<string, unknown> | null;
  event_time: string | null;
  observed_at: string;
  valid_from: string | null;
  valid_to: string | null;
  status: string;
  assertion_kind: string;
  supersedes_id: string | null;
  metadata: Record<string, unknown>;
}

/**
 * What is still true about this person right now?
 *
 * The query cosine cannot express. "Training for a marathon" and "I quit the
 * marathon" are near-identical to an embedding; they are trivially different
 * to `valid_to IS NULL`.
 */
export async function currentTruth(options: {
  userId: string;
  predicate?: string;
  subjectEntityId?: string;
  limit?: number;
}): Promise<FactRow[]> {
  let q = supabase
    .from(Tables.ASSERTIONS)
    .select('*')
    .eq('user_id', options.userId)
    .eq('status', 'active')
    .is('valid_to', null)                    // <- in SQL, not afterwards
    .order('observed_at', { ascending: false })
    .limit(options.limit ?? 200);

  if (options.predicate) q = q.eq('predicate', options.predicate);
  if (options.subjectEntityId) q = q.eq('subject_entity_id', options.subjectEntityId);

  const { data, error } = await q;
  if (error) throw new Error(`currentTruth failed: ${error.message}`);
  return (data ?? []) as FactRow[];
}

export interface ChangeRow {
  fact: FactRow;
  change: 'became_true' | 'retired';
  /** For a retirement, the fact that replaced it, when there is one. */
  replacedBy?: FactRow | null;
}

/**
 * How is this person different from three months ago?
 *
 * Returns both halves of every change, so a consumer can say "you were doing
 * X, now you are doing Y" rather than just noticing Y.
 */
export async function changedSince(options: {
  userId: string;
  since: string;
  limit?: number;
}): Promise<ChangeRow[]> {
  const limit = options.limit ?? 200;

  const [appeared, retired] = await Promise.all([
    supabase.from(Tables.ASSERTIONS).select('*')
      .eq('user_id', options.userId).eq('status', 'active').is('valid_to', null)
      .gte('observed_at', options.since)
      .order('observed_at', { ascending: false }).limit(limit),
    supabase.from(Tables.ASSERTIONS).select('*')
      .eq('user_id', options.userId).not('valid_to', 'is', null)
      .gte('valid_to', options.since)
      .order('valid_to', { ascending: false }).limit(limit),
  ]);

  if (appeared.error) throw new Error(`changedSince (new) failed: ${appeared.error.message}`);
  if (retired.error) throw new Error(`changedSince (retired) failed: ${retired.error.message}`);

  const retiredRows = (retired.data ?? []) as FactRow[];
  const successorIds = retiredRows.map((r) => r.id);

  // Pair each retirement with what replaced it.
  let successors: FactRow[] = [];
  if (successorIds.length > 0) {
    const { data } = await supabase.from(Tables.ASSERTIONS).select('*')
      .eq('user_id', options.userId).in('supersedes_id', successorIds);
    successors = (data ?? []) as FactRow[];
  }
  const bySuperseded = new Map(successors.map((s) => [s.supersedes_id!, s]));

  return [
    ...((appeared.data ?? []) as FactRow[]).map((fact) => ({
      fact, change: 'became_true' as const,
    })),
    ...retiredRows.map((fact) => ({
      fact,
      change: 'retired' as const,
      replacedBy: bySuperseded.get(fact.id) ?? null,
    })),
  ];
}

/** Everything the bank knows about one entity, current by default. */
export async function factsAbout(options: {
  userId: string;
  entityId: string;
  includeHistorical?: boolean;
  limit?: number;
}): Promise<FactRow[]> {
  let q = supabase.from(Tables.ASSERTIONS).select('*')
    .eq('user_id', options.userId)
    .or(`subject_entity_id.eq.${options.entityId},object_entity_id.eq.${options.entityId}`)
    .order('observed_at', { ascending: false })
    .limit(options.limit ?? 100);

  if (!options.includeHistorical) q = q.eq('status', 'active').is('valid_to', null);

  const { data, error } = await q;
  if (error) throw new Error(`factsAbout failed: ${error.message}`);
  return (data ?? []) as FactRow[];
}

/**
 * What they say they want, against what they are actually doing.
 * A locked capability (01): stated goals vs live behaviour.
 */
export async function goalsVsBehavior(userId: string): Promise<{
  stated: FactRow[];
  quit: FactRow[];
  abandonedGoals: FactRow[];
}> {
  const [stated, quit] = await Promise.all([
    currentTruth({ userId, predicate: 'stated_goal' }),
    supabase.from(Tables.ASSERTIONS).select('*')
      .eq('user_id', userId).eq('predicate', 'quit_or_stopped')
      .order('observed_at', { ascending: false }).limit(100),
  ]);
  const quitRows = (quit.data ?? []) as FactRow[];

  // Goals retired by a quit -- said one thing, did another, and the bank knows.
  const { data: abandoned } = await supabase.from(Tables.ASSERTIONS).select('*')
    .eq('user_id', userId).eq('predicate', 'stated_goal').eq('status', 'superseded');

  return {
    stated,
    quit: quitRows,
    abandonedGoals: (abandoned ?? []) as FactRow[],
  };
}

/** Quotes only. How they narrate themselves. */
export async function selfTalk(options: {
  userId: string;
  since?: string;
  limit?: number;
}): Promise<FactRow[]> {
  let q = supabase.from(Tables.ASSERTIONS).select('*')
    .eq('user_id', options.userId).eq('predicate', 'said_about_self')
    .order('event_time', { ascending: false })
    .limit(options.limit ?? 50);
  if (options.since) q = q.gte('observed_at', options.since);

  const { data, error } = await q;
  if (error) throw new Error(`selfTalk failed: ${error.message}`);
  return (data ?? []) as FactRow[];
}
