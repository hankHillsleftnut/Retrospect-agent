/**
 * The pattern promoter.
 *
 * The riskiest component in the system. A wrong merge does not produce an
 * error -- it produces a confident, invented claim about someone's character
 * that everything downstream then treats as true. So this file prefers to
 * UNDER-merge everywhere the choice exists: two separate patterns are
 * recoverable, one invented "avoidance" is not.
 *
 * docs/second-brain/01 Q6 + Examples A/D, 04 §4, 05 D4 + D10.
 */

export type Severity = 'standard' | 'high' | 'extreme';

export interface FactForPromotion {
  assertionId: string;
  predicate: string;
  /** Normalized object text. */
  object: string;
  eventTime: string;
  sourceId: string;
  contentType: string;
  severity: Severity;
  /** The user naming their own loop. Seeds a candidate; never promotes alone. */
  namesOwnLoop?: boolean;
  /**
   * An explicit external cause stated in the text ("flight delayed", "funeral").
   * Three misses with three unrelated causes is a coincidence; three with no
   * cause is a pattern. This is the single signal that separates a real loop
   * from a run of bad luck, and without it the promoter fires on both.
   */
  externalCause?: string | null;
}

/**
 * How much one instance from this source is worth.
 *
 * Three calendar rows are not three journal entries. A journal is a deliberate
 * act roughly once a day; HealthKit emits hundreds. Counting them equally lets
 * a noisy connector manufacture a pattern a human would never call one.
 */
export function sourceWeight(contentType: string): number {
  switch (contentType) {
    case 'journal_entry':
    case 'text_entry':
    case 'voice_journal':
    case 'voice_recording':
    case 'onboarding_profile':
      return 1;
    case 'google_docs':
    case 'gmail':
      return 0.6;
    case 'calendar':
      return 0.4;
    case 'healthkit':
    case 'screen_time':
    case 'apple_music':
    case 'photos':
      return 0.15;
    default:
      return 0.5;
  }
}

const STOPWORDS = new Set(['the', 'a', 'an', 'my', 'to', 'of', 'and', 'i', 'it', 'that', 'this']);

export function objectTokens(object: string): string[] {
  return object.split('_').filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Predicates that describe the same family of behaviour. */
const PREDICATE_FAMILY: Record<string, string> = {
  skipped_or_avoided: 'avoidance',
  quit_or_stopped: 'avoidance',
  attended: 'participation',
  communicated_with: 'social',
  mentioned_person: 'social',
  said_about_self: 'self_talk',
  felt: 'affect',
};

export function predicateFamily(predicate: string): string {
  return PREDICATE_FAMILY[predicate] ?? predicate;
}

function weekday(iso: string): number {
  return new Date(iso).getUTCDay();
}

/**
 * Grouping is CLUSTERING, not a per-fact hash.
 *
 * "thursday_standup", "standup_invite_ignored" and "couldnt_face_standup" are
 * the same loop described three ways. No key computed from one fact in
 * isolation can see that -- they share only the token "standup". So facts join
 * a cluster when they agree on the predicate family AND share a substantive
 * token with something already in it.
 *
 * Requiring a shared token is what keeps "skips standup" and "cancels on a
 * friend" apart. Both are avoidance-flavoured; a family-only key would fuse
 * them into one meaningless mega-pattern that makes the person sound more
 * troubled than they are. Two patterns are recoverable; that one is not.
 */
export function groupingKey(fact: FactForPromotion): string | null {
  const tokens = objectTokens(fact.object);
  if (tokens.length === 0) return null;
  return `${predicateFamily(fact.predicate)}:${tokens.slice().sort()[0]}`;
}

/** The shared anchor a formed cluster is named for. */
export function clusterKey(facts: FactForPromotion[]): string | null {
  if (facts.length === 0) return null;
  const family = predicateFamily(facts[0]!.predicate);

  const counts = new Map<string, number>();
  for (const fact of facts) {
    for (const token of new Set(objectTokens(fact.object))) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;

  // The token the most facts agree on; ties broken alphabetically so the key
  // is stable no matter what order the facts arrive in.
  const best = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )[0]!;
  return `${family}:${best[0]}`;
}

export interface Bar {
  minInstances: number;
  minWeighted: number;
  requiresSpanOrSources: boolean;
}

export const BARS: Record<Severity, Bar> = {
  // >= 3 instances AND (> 1 week span OR > 1 source)
  standard: { minInstances: 3, minWeighted: 2.0, requiresSpanOrSources: true },
  // Severe things need a shorter bar, but still more than one occasion.
  high: { minInstances: 2, minWeighted: 1.2, requiresSpanOrSources: false },
  // Stored as knowledge. Never auto-promoted into anything that speaks.
  extreme: { minInstances: Number.POSITIVE_INFINITY, minWeighted: Infinity, requiresSpanOrSources: true },
};

export const ONE_WEEK_MS = 7 * 864e5;

export interface PromotionDecision {
  groupingKey: string;
  status: 'candidate' | 'live';
  severity: Severity;
  episodePromotable: boolean;
  instanceCount: number;
  weightedCount: number;
  sourceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  spanMs: number;
  reason: string;
  facts: FactForPromotion[];
}

/**
 * Decide what a group of facts amounts to. Pure: no database, no model.
 */
export function evaluateGroup(facts: FactForPromotion[]): PromotionDecision | null {
  if (facts.length === 0) return null;
  const key = clusterKey(facts);
  if (!key) return null;

  const sorted = [...facts].sort(
    (a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime()
  );
  const first = sorted[0]!.eventTime;
  const last = sorted[sorted.length - 1]!.eventTime;
  const spanMs = new Date(last).getTime() - new Date(first).getTime();

  const severity: Severity = facts.some((f) => f.severity === 'extreme')
    ? 'extreme'
    : facts.some((f) => f.severity === 'high')
      ? 'high'
      : 'standard';

  const weighted = facts.reduce((acc, f) => acc + sourceWeight(f.contentType), 0);
  const sources = new Set(facts.map((f) => f.sourceId)).size;

  const base = {
    groupingKey: key,
    severity,
    instanceCount: facts.length,
    weightedCount: Number(weighted.toFixed(2)),
    sourceCount: sources,
    firstSeenAt: first,
    lastSeenAt: last,
    spanMs,
    facts: sorted,
  };

  // Extreme content is stored and never narrated unasked. Different product path.
  if (severity === 'extreme') {
    return { ...base, status: 'candidate', episodePromotable: false,
      reason: 'extreme severity: stored, never auto-promoted' };
  }

  // Coincidence guard. If nearly every instance carries its own distinct
  // external cause, this is a run of bad luck, not a loop. A flight, a fever
  // and a funeral look exactly like avoidance from the outside.
  const causes = facts.map((f) => f.externalCause).filter(Boolean) as string[];
  const distinctCauses = new Set(causes).size;
  if (causes.length >= facts.length - 1 && distinctCauses >= 2) {
    return { ...base, status: 'candidate', episodePromotable: true,
      reason: `each instance has its own external cause (${distinctCauses} distinct): coincidence, not a loop` };
  }

  const bar = BARS[severity];
  const selfNamed = facts.some((f) => f.namesOwnLoop);

  // The user naming their own loop is strong corroboration, so one real
  // behavioural instance alongside it clears the high bar rather than the
  // standard one. It never promotes on its own: saying it is a Fact.
  const effectiveBar = selfNamed && severity === 'standard' ? BARS.high : bar;

  if (facts.length < effectiveBar.minInstances || weighted < effectiveBar.minWeighted) {
    return { ...base, status: 'candidate', episodePromotable: true,
      reason: `below bar: ${facts.length} instances / ${weighted.toFixed(2)} weighted, need ${effectiveBar.minInstances} / ${effectiveBar.minWeighted}` };
  }

  if (effectiveBar.requiresSpanOrSources && spanMs <= ONE_WEEK_MS && sources < 2) {
    return { ...base, status: 'candidate', episodePromotable: true,
      reason: 'instances too close together and from one source' };
  }

  return { ...base, status: 'live', episodePromotable: true,
    reason: selfNamed ? 'bar met (self-named loop corroborated by behaviour)' : 'bar met' };
}

/**
 * Cluster facts into candidate loops by shared substantive tokens within a
 * predicate family. Single-linkage, which is the permissive direction -- so
 * the token requirement is doing the real restraining.
 */
export function groupFacts(facts: FactForPromotion[]): Map<string, FactForPromotion[]> {
  const usable = facts.filter((f) => objectTokens(f.object).length > 0);
  const clusters: { family: string; tokens: Set<string>; facts: FactForPromotion[] }[] = [];

  for (const fact of usable) {
    const family = predicateFamily(fact.predicate);
    const tokens = new Set(objectTokens(fact.object));
    const hit = clusters.find(
      (c) => c.family === family && [...tokens].some((t) => c.tokens.has(t))
    );
    if (hit) {
      hit.facts.push(fact);
      for (const t of tokens) hit.tokens.add(t);
    } else {
      clusters.push({ family, tokens, facts: [fact] });
    }
  }

  const out = new Map<string, FactForPromotion[]>();
  for (const cluster of clusters) {
    const key = clusterKey(cluster.facts);
    if (!key) continue;
    // Two clusters can land on the same anchor; merge rather than clobber.
    out.set(key, [...(out.get(key) ?? []), ...cluster.facts]);
  }
  return out;
}

export const DECAY_HALF_LIFE_DAYS = 45;

/**
 * Confidence falls as the newest evidence ages, so a loop someone stopped can
 * die instead of standing forever. Without this a pattern is a life sentence.
 */
export function decayedConfidence(options: {
  baseConfidence: number;
  lastSeenAt: string;
  now?: Date;
}): number {
  const now = (options.now ?? new Date()).getTime();
  const age = now - new Date(options.lastSeenAt).getTime();
  if (age <= 0) return options.baseConfidence;
  const decay = Math.pow(0.5, age / (DECAY_HALF_LIFE_DAYS * 864e5));
  return Number((options.baseConfidence * decay).toFixed(3));
}

/** Below this a live pattern falls back to candidate: it is not current any more. */
export const LIVE_CONFIDENCE_FLOOR = 0.2;

export function shouldDemote(confidence: number): boolean {
  return confidence < LIVE_CONFIDENCE_FLOOR;
}
