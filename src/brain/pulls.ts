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

// ── Patterns ────────────────────────────────────────────────────────────────

export interface PatternRow {
  id: string;
  slug: string;
  label: string;
  status: string;
  severity: string;
  episode_promotable: boolean;
  instance_count: number;
  weighted_count: number;
  source_count: number;
  confidence: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  grouping_key: string;
  promoter_version: string;
  metadata: Record<string, unknown>;
}

/**
 * What loops is this person currently in?
 *
 * A plain indexed select. It must never scan raw journals: the whole point of
 * promoting a Pattern was so that next week's episode can ask this question
 * instead of re-deriving it from scratch.
 */
export async function livePatterns(options: {
  userId: string;
  includeNonPromotable?: boolean;
  limit?: number;
}): Promise<PatternRow[]> {
  let q = supabase
    .from(Tables.BEHAVIOR_PATTERNS)
    .select('*')
    .eq('user_id', options.userId)
    .eq('status', 'live')
    .order('confidence', { ascending: false })
    .limit(options.limit ?? 50);

  // Extreme patterns are knowledge, not episode fuel. A consumer must ask
  // explicitly to see them (01 Example D, 05 D10).
  if (!options.includeNonPromotable) q = q.eq('episode_promotable', true);

  const { data, error } = await q;
  if (error) throw new Error(`livePatterns failed: ${error.message}`);
  return (data ?? []) as PatternRow[];
}

/** One pattern, its inferred why, and the facts holding it up. */
export async function pattern(options: {
  userId: string;
  patternId: string;
}): Promise<{ pattern: PatternRow; whys: any[]; facts: FactRow[] } | null> {
  const { data: row, error } = await supabase
    .from(Tables.BEHAVIOR_PATTERNS).select('*')
    .eq('user_id', options.userId).eq('id', options.patternId).maybeSingle();
  if (error) throw new Error(`pattern failed: ${error.message}`);
  if (!row) return null;

  const [whys, facts] = await Promise.all([
    supabase.from(Tables.BEHAVIOR_PATTERN_WHYS).select('*')
      .eq('pattern_id', options.patternId).is('retired_at', null),
    factsFor({ userId: options.userId, patternId: options.patternId }),
  ]);

  return { pattern: row as PatternRow, whys: whys.data ?? [], facts };
}

/** The evidence under a pattern, so a claim can always be shown its receipts. */
export async function factsFor(options: {
  userId: string;
  patternId: string;
  role?: 'supports' | 'weakly_related' | 'counter_evidence';
}): Promise<FactRow[]> {
  let link = supabase.from(Tables.BEHAVIOR_PATTERN_FACTS)
    .select('assertion_id').eq('pattern_id', options.patternId);
  if (options.role) link = link.eq('role', options.role);

  const { data: links, error } = await link;
  if (error) throw new Error(`factsFor failed: ${error.message}`);
  const ids = (links ?? []).map((l: { assertion_id: string }) => l.assertion_id);
  if (ids.length === 0) return [];

  const { data, error: factErr } = await supabase
    .from(Tables.ASSERTIONS).select('*')
    .eq('user_id', options.userId).in('id', ids)
    .order('event_time', { ascending: true });
  if (factErr) throw new Error(`factsFor assertions failed: ${factErr.message}`);
  return (data ?? []) as FactRow[];
}

// ── People, gaps, lineage ───────────────────────────────────────────────────

export interface PersonRow {
  id: string;
  canonical_name: string;
  significance: number;
  mentions: number;
}

/** People who actually matter to this person, most significant first. */
export async function significantPeople(options: {
  userId: string;
  minSignificance?: number;
  limit?: number;
}): Promise<PersonRow[]> {
  const { data, error } = await supabase
    .from(Tables.ENTITIES).select('id,canonical_name,attributes')
    .eq('user_id', options.userId).eq('entity_type', 'person')
    .limit(options.limit ?? 50);
  if (error) throw new Error(`significantPeople failed: ${error.message}`);

  const floor = options.minSignificance ?? 0.1;
  return (data ?? [])
    .map((e: any) => ({
      id: e.id,
      canonical_name: e.canonical_name,
      significance: Number(e.attributes?.significance ?? 0),
      mentions: Number(e.attributes?.significance_mentions ?? 0),
    }))
    .filter((p: PersonRow) => p.significance >= floor)
    .sort((a: PersonRow, b: PersonRow) => b.significance - a.significance);
}

/**
 * What don't we know?
 *
 * A required field of every evidence pack. Admitting a blind spot is what
 * separates knowing someone from performing it -- and it stops the writer
 * quietly filling silence with invention.
 */
export async function gaps(options: {
  userId: string;
  since: string;
  expectedSources?: string[];
}): Promise<string[]> {
  const expected = options.expectedSources ?? ['journal_entry', 'calendar', 'healthkit'];

  const { data, error } = await supabase
    .from(Tables.RAW_CONTENT).select('content_type')
    .eq('user_id', options.userId).gte('created_at', options.since);
  if (error) throw new Error(`gaps failed: ${error.message}`);

  const seen = new Set((data ?? []).map((r: { content_type: string }) => r.content_type));
  const out = expected.filter((s) => !seen.has(s)).map((s) => `no ${s.replace(/_/g, ' ')} data in this period`);

  const { count } = await supabase
    .from(Tables.ASSERTIONS).select('id', { count: 'exact', head: true })
    .eq('user_id', options.userId).gte('observed_at', options.since);
  if ((count ?? 0) === 0) out.push('no new facts were recorded in this period');

  return out;
}

export type LineageDirection = 'backward' | 'forward';

export interface LineageNode {
  kind: 'raw_content' | 'assertion' | 'pattern' | 'why';
  id: string;
  summary: string;
  /** Where a chain stopped, and why -- a dead end with a reason beats silence. */
  stoppedBecause?: string;
}

/**
 * Walk the provenance chain from any ID.
 *
 * backward: "why did it say that" -- pattern -> facts -> excerpts -> journal
 * forward:  "where did this journal end up" -- and, just as usefully, where it
 *           STOPPED. Most information never reaches a podcast by design.
 */
export async function lineage(options: {
  userId: string;
  id: string;
  kind: 'raw_content' | 'assertion' | 'pattern';
  direction: LineageDirection;
}): Promise<LineageNode[]> {
  const out: LineageNode[] = [];

  if (options.direction === 'backward') {
    if (options.kind === 'pattern') {
      const facts = await factsFor({ userId: options.userId, patternId: options.id });
      for (const f of facts) out.push({ kind: 'assertion', id: f.id, summary: f.predicate });
      if (facts.length === 0) {
        out.push({ kind: 'pattern', id: options.id, summary: 'pattern',
          stoppedBecause: 'no supporting facts are linked to this pattern' });
      }
      return out;
    }
    const { data: ev } = await supabase.from(Tables.ASSERTION_EVIDENCE)
      .select('raw_content_id,excerpt,char_start,char_end')
      .eq('assertion_id', options.id);
    for (const e of (ev ?? []) as any[]) {
      out.push({
        kind: 'raw_content',
        id: e.raw_content_id ?? '(structured source)',
        summary: e.excerpt ?? '',
      });
    }
    if (out.length === 0) {
      out.push({ kind: 'assertion', id: options.id, summary: 'assertion',
        stoppedBecause: 'no evidence rows -- this fact cannot show its receipts' });
    }
    return out;
  }

  // forward
  const { data: ev } = await supabase.from(Tables.ASSERTION_EVIDENCE)
    .select('assertion_id').eq('raw_content_id', options.id);
  const assertionIds = (ev ?? []).map((e: { assertion_id: string }) => e.assertion_id);

  if (assertionIds.length === 0) {
    return [{ kind: 'raw_content', id: options.id, summary: 'source',
      stoppedBecause: 'produced no facts -- extraction found nothing verifiable here' }];
  }

  const { data: facts } = await supabase.from(Tables.ASSERTIONS)
    .select('id,predicate,status,valid_to,supersedes_id')
    .eq('user_id', options.userId).in('id', assertionIds);

  for (const f of (facts ?? []) as any[]) {
    out.push({
      kind: 'assertion', id: f.id, summary: f.predicate,
      stoppedBecause: f.status !== 'active'
        ? `${f.status}${f.valid_to ? ` on ${String(f.valid_to).slice(0, 10)}` : ''}`
        : undefined,
    });
  }

  const { data: links } = await supabase.from(Tables.BEHAVIOR_PATTERN_FACTS)
    .select('pattern_id').in('assertion_id', assertionIds);
  const patternIds = [...new Set((links ?? []).map((l: { pattern_id: string }) => l.pattern_id))];

  if (patternIds.length === 0) {
    out.push({ kind: 'pattern', id: '(none)', summary: 'no pattern',
      stoppedBecause: 'these facts have not repeated enough to become a pattern' });
    return out;
  }

  const { data: patterns } = await supabase.from(Tables.BEHAVIOR_PATTERNS)
    .select('id,label,status').in('id', patternIds);
  for (const p of (patterns ?? []) as any[]) {
    out.push({
      kind: 'pattern', id: p.id, summary: p.label,
      stoppedBecause: p.status !== 'live' ? `pattern is ${p.status}` : undefined,
    });
  }
  return out;
}
