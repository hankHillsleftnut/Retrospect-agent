/**
 * Why -- an inferred mechanism, attached ONLY to a live Pattern.
 *
 * The founder's rule, and the answer to "what if an intimate inference is
 * wrong": never infer why from a single event. A Why cannot exist before a
 * Pattern does, because a mechanism is only a sensible question once there is
 * a repetition to explain.
 *
 * Two things that look alike and are not:
 *   user-stated why   -- "I skipped because I was ashamed"  -> a FACT
 *   inferred why      -- "this is shame-avoidance"           -> this object
 * They never share a column. docs/second-brain/01 Q5, 04 §5, 05 D4.
 */

export type Mechanism = 'avoidance' | 'ambivalence' | 'capacity' | 'unclear';

export const MECHANISMS: Mechanism[] = ['avoidance', 'ambivalence', 'capacity', 'unclear'];

/** A Why is provisional by default and low-confidence by design. */
export const DEFAULT_WHY_CONFIDENCE = 0.3;
/** Above this a provisional inference would be overclaiming. */
export const MAX_WHY_CONFIDENCE = 0.6;

export interface PatternForWhy {
  id: string;
  status: 'candidate' | 'live' | 'retired' | 'user_rejected';
  severity: 'standard' | 'high' | 'extreme';
  instanceCount: number;
  episodePromotable: boolean;
}

export type WhyRefusal =
  | 'pattern_not_live'
  | 'extreme_severity'
  | 'insufficient_instances'
  | 'user_rejected';

export type WhyGate =
  | { allowed: true }
  | { allowed: false; reason: WhyRefusal };

/**
 * May the system theorise about this pattern at all?
 *
 * Pure, so the rule can be read and tested in isolation rather than being
 * buried in a prompt where it becomes a request rather than a constraint.
 * The prompt asking nicely is exactly how identity_inferences ended up with
 * retirement columns nothing ever used.
 */
export function canInferWhy(pattern: PatternForWhy): WhyGate {
  if (pattern.status === 'user_rejected') return { allowed: false, reason: 'user_rejected' };
  if (pattern.status !== 'live') return { allowed: false, reason: 'pattern_not_live' };

  // Never psychoanalyse a crisis. Storing the facts is the product; explaining
  // them back to someone unasked is a different, unbuilt product (05 D10).
  if (pattern.severity === 'extreme' || !pattern.episodePromotable) {
    return { allowed: false, reason: 'extreme_severity' };
  }

  // Belt and braces: a live pattern should already clear this, but a Why is
  // the single most damaging thing to get wrong, so it re-checks.
  if (pattern.instanceCount < 2) return { allowed: false, reason: 'insufficient_instances' };

  return { allowed: true };
}

export interface WhyDraft {
  patternId: string;
  mechanism: Mechanism;
  confidence: number;
  evidenceAssertionIds: string[];
}

/** Clamp anything a model proposes into the provisional range. */
export function sanitizeWhy(draft: {
  patternId: string;
  mechanism: string;
  confidence?: number;
  evidenceAssertionIds?: string[];
}): WhyDraft {
  const mechanism = (MECHANISMS as string[]).includes(draft.mechanism)
    ? (draft.mechanism as Mechanism)
    : 'unclear';

  const confidence = Math.min(
    MAX_WHY_CONFIDENCE,
    Math.max(0.05, draft.confidence ?? DEFAULT_WHY_CONFIDENCE)
  );

  return {
    patternId: draft.patternId,
    mechanism,
    confidence: Number(confidence.toFixed(3)),
    evidenceAssertionIds: draft.evidenceAssertionIds ?? [],
  };
}

/**
 * Should an existing Why be retired?
 *
 * A conclusion must not outlive its evidence. If the pattern stopped being
 * live, or the facts it rested on were retired, the inference goes -- the
 * Pattern and the Facts stay.
 */
export function shouldRetireWhy(options: {
  pattern: PatternForWhy;
  liveEvidenceCount: number;
}): { retire: boolean; reason?: string } {
  if (options.pattern.status !== 'live') {
    return { retire: true, reason: 'pattern no longer live' };
  }
  if (options.pattern.severity === 'extreme') {
    return { retire: true, reason: 'pattern reclassified as extreme' };
  }
  if (options.liveEvidenceCount === 0) {
    return { retire: true, reason: 'all supporting facts retired' };
  }
  return { retire: false };
}
