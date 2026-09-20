/**
 * The evidence pack -- what the writer is allowed to use this run.
 *
 * Converts "don't make things up" from an instruction into a constraint. Cook C
 * may name no Pattern whose id is not in here (01 acceptance test 9).
 *
 * Built by asking the bank a fixed set of questions rather than embedding a
 * mood and hoping. The pulls are SQL, so the research step costs almost
 * nothing and returns exact rows instead of eight loosely similar paragraphs.
 *
 * docs/second-brain/01 Example E, 04 §7, 14.
 */

import {
  currentTruth, changedSince, livePatterns, factsFor,
  goalsVsBehavior, significantPeople, selfTalk, gaps,
  type FactRow, type PatternRow, type PersonRow,
} from './pulls';
import { buildPortrait, type PortraitDocument } from './portrait';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export interface QueryLogEntry {
  pull: string;
  count: number;
  ms: number;
}

export interface EvidencePack {
  userId: string;
  builtAt: string;
  since: string;

  portrait: PortraitDocument;
  patterns: PatternRow[];
  /** Pattern id -> the facts holding it up, so a claim can show its receipts. */
  factsByPattern: Record<string, FactRow[]>;
  recentFacts: FactRow[];
  changes: Awaited<ReturnType<typeof changedSince>>;
  goals: Awaited<ReturnType<typeof goalsVsBehavior>>;
  people: PersonRow[];
  quotes: FactRow[];

  /** Required field. Admitting a blind spot is what separates knowing
   *  someone from performing it. */
  gaps: string[];

  /** Everything the writer may cite. Anything outside this is invention. */
  allowedPatternIds: string[];
  allowedAssertionIds: string[];

  queryLog: QueryLogEntry[];
}

async function timed<T>(pull: string, log: QueryLogEntry[], fn: () => Promise<T>, size: (r: T) => number): Promise<T> {
  const t0 = Date.now();
  const result = await fn();
  log.push({ pull, count: size(result), ms: Date.now() - t0 });
  return result;
}

/**
 * The Example E loop, in order.
 *
 * Note what is absent: no embedding of a vibe, no cosine search over derived
 * tables, no inventing a pattern in the moment and forgetting it by next week.
 */
export async function buildEvidencePack(options: {
  userId: string;
  since: string;
  maxPatterns?: number;
}): Promise<EvidencePack> {
  const { userId, since } = options;
  const queryLog: QueryLogEntry[] = [];

  const portrait = await timed('portrait', queryLog,
    () => buildPortrait(userId), (p) => Object.values(p.blocks).filter((b) => b.populated).length);

  const patterns = await timed('live_patterns', queryLog,
    () => livePatterns({ userId, limit: options.maxPatterns ?? 10 }), (r) => r.length);

  const factsByPattern: Record<string, FactRow[]> = {};
  for (const p of patterns) {
    factsByPattern[p.id] = await timed(`facts_for(${p.slug})`, queryLog,
      () => factsFor({ userId, patternId: p.id }), (r) => r.length);
  }

  const [recentFacts, changes, goals, people, quotes, gapList] = await Promise.all([
    timed('recent_facts', queryLog,
      () => currentTruth({ userId, limit: 60 }), (r) => r.length),
    timed('changed_since', queryLog,
      () => changedSince({ userId, since }), (r) => r.length),
    timed('goals_vs_behavior', queryLog,
      () => goalsVsBehavior(userId), (r) => r.stated.length + r.quit.length),
    timed('significant_people', queryLog,
      () => significantPeople({ userId, limit: 10 }), (r) => r.length),
    timed('self_talk', queryLog,
      () => selfTalk({ userId, since, limit: 15 }), (r) => r.length),
    timed('gaps', queryLog,
      () => gaps({ userId, since }), (r) => r.length),
  ]);

  const allowedAssertionIds = [...new Set([
    ...recentFacts.map((f) => f.id),
    ...Object.values(factsByPattern).flat().map((f) => f.id),
    ...quotes.map((f) => f.id),
    ...changes.map((c) => c.fact.id),
    ...goals.stated.map((f) => f.id),
    ...goals.quit.map((f) => f.id),
    ...Object.values(portrait.blocks).flatMap((b) => b.sourceAssertionIds),
  ])];

  const allowedPatternIds = [...new Set([
    ...patterns.map((p) => p.id),
    ...Object.values(portrait.blocks).flatMap((b) => b.sourcePatternIds),
  ])];

  return {
    userId, builtAt: new Date().toISOString(), since,
    portrait, patterns, factsByPattern, recentFacts, changes, goals, people, quotes,
    gaps: gapList,
    allowedPatternIds, allowedAssertionIds,
    queryLog,
  };
}

/** Is every id this claim cites actually in the pack? */
export function validateCitations(pack: EvidencePack, cites: {
  patternIds?: string[];
  assertionIds?: string[];
}): { ok: boolean; unknownPatternIds: string[]; unknownAssertionIds: string[] } {
  const p = new Set(pack.allowedPatternIds);
  const a = new Set(pack.allowedAssertionIds);
  const unknownPatternIds = (cites.patternIds ?? []).filter((id) => !p.has(id));
  const unknownAssertionIds = (cites.assertionIds ?? []).filter((id) => !a.has(id));
  return {
    ok: unknownPatternIds.length === 0 && unknownAssertionIds.length === 0,
    unknownPatternIds,
    unknownAssertionIds,
  };
}

/** Persist the pack so an episode can always answer "what was this based on". */
export async function persistPack(options: {
  pack: EvidencePack;
  episodeId?: string | null;
  traceId?: string | null;
}): Promise<void> {
  const summary = {
    built_at: options.pack.builtAt,
    since: options.pack.since,
    pattern_ids: options.pack.allowedPatternIds,
    assertion_ids: options.pack.allowedAssertionIds,
    gaps: options.pack.gaps,
    query_log: options.pack.queryLog,
    portrait_slots: Object.entries(options.pack.portrait.blocks)
      .filter(([, b]) => b.populated).map(([slot]) => slot),
  };

  if (options.episodeId) {
    await supabase.from(Tables.PODCAST_EPISODES)
      .update({ evidence_pack: summary }).eq('id', options.episodeId);
  }
  if (options.traceId) {
    await supabase.from(Tables.PIPELINE_RUN_TRACES)
      .update({ evidence_pack: summary }).eq('id', options.traceId);
  }
}
