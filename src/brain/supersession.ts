/**
 * Deterministic supersession.
 *
 * Cosine similarity cannot tell a contradiction from a duplicate -- "training
 * for a marathon" and "I quit the marathon" look nearly identical to an
 * embedding (MemStrata 2026 measures this at roughly chance). So time is
 * applied by CODE, never by the model: the extractor proposes claims, this
 * decides what they do to what we already believed.
 *
 * docs/second-brain/04 §3, 01 Example B, 05 D6.
 */

/**
 * The distinction the whole thing rests on.
 *
 * EPISODIC facts happened at a moment. Two of them never contradict: skipping
 * standup on the 12th and skipping it on the 26th are two separate truths.
 * If supersession fired here, three Thursday skips would collapse into one and
 * the pattern promoter would have nothing left to count -- the feature would
 * quietly destroy the feature it exists to serve.
 *
 * STATEFUL facts describe an ongoing condition. Only these can be replaced.
 */
export const STATEFUL_PREDICATES = new Set([
  'stated_goal',
  'mentioned_person',
  'health_metric',
]);

export const EPISODIC_PREDICATES = new Set([
  'skipped_or_avoided',
  'attended',
  'said_about_self',
  'felt',
  'scheduled',
  'communicated_with',
  'quit_or_stopped',
]);

/** Predicates that retire a different predicate about the same topic. */
const RETIRES: Record<string, string[]> = {
  quit_or_stopped: ['stated_goal'],
};

/** Exported so the write path can narrow its lookup to predicates that could
 *  actually be retired, instead of scanning every active fact about a subject. */
export const RETIRED_BY = RETIRES;

export type Relation = 'duplicate' | 'supersedes' | 'refines' | 'unrelated';

export interface ClaimShape {
  predicate: string;
  /** Normalized object text (see normalizeObject). */
  object: string;
  eventTime?: string | null;
}

/** Conservative topic match. Under-fires on purpose: a missed supersession
 *  leaves a stale fact, a wrong one erases history. */
export function sameTopic(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const at = a.split('_').filter(Boolean);
  const bt = b.split('_').filter(Boolean);
  const [short, long] = at.length <= bt.length ? [at, bt] : [bt, at];
  if (short.length === 0) return false;

  // Every token must be substantial, so "a_b" cannot latch onto anything.
  if (short.join('').length < 4) return false;

  // The shorter topic must appear as a CONTIGUOUS run of whole tokens inside
  // the longer one: "marathon" matches "half_marathon_training", but "art"
  // never matches "artichokes".
  for (let i = 0; i + short.length <= long.length; i++) {
    let hit = true;
    for (let j = 0; j < short.length; j++) {
      if (long[i + j] !== short[j]) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

/**
 * What does `incoming` do to `existing`?
 *
 * Pure. No database, no model, no clock beyond the event times it is handed.
 */
export function classifyRelation(existing: ClaimShape, incoming: ClaimShape): Relation {
  const samePredicate = existing.predicate === incoming.predicate;
  const sameObject = existing.object === incoming.object;

  if (samePredicate && sameObject) return 'duplicate';

  // A quit retires the goal it was about.
  const retires = RETIRES[incoming.predicate] ?? [];
  if (retires.includes(existing.predicate) && sameTopic(existing.object, incoming.object)) {
    return 'supersedes';
  }

  if (!samePredicate) return 'unrelated';

  // Same predicate, different object.
  if (EPISODIC_PREDICATES.has(incoming.predicate)) {
    // Two events. Both true. This is the line that keeps patterns countable.
    return 'unrelated';
  }

  if (STATEFUL_PREDICATES.has(incoming.predicate)) {
    // An ongoing condition restated differently about the same topic replaces
    // the old reading; about a different topic it is simply a second fact.
    return sameTopic(existing.object, incoming.object) ? 'supersedes' : 'unrelated';
  }

  // Unknown predicate: refuse to guess. A stale fact beats erased history.
  return 'unrelated';
}

/**
 * Additional detail that neither contradicts nor duplicates.
 * Kept separate from classifyRelation so the caller can decide whether to
 * bother recording the link.
 */
export function isRefinement(existing: ClaimShape, incoming: ClaimShape): boolean {
  if (existing.predicate !== incoming.predicate) return false;
  if (existing.object === incoming.object) return false;
  return STATEFUL_PREDICATES.has(incoming.predicate) && sameTopic(existing.object, incoming.object);
}
