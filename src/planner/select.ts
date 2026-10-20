/**
 * Choosing what is worth saying (W5.1): the planner's core.
 *
 * Calibrated 20 Oct (approach-calibration.md): select-then-write, with
 * determinantal-point-process-style selection over atomic items, quality times
 * diversity, relevance to the person built into quality (Padmakumar et al.,
 * ACL 2025). Deterministic: a model never decides what matters to a person
 * (zero-shot LLM selection loses to a trivial baseline on personal relevance).
 *
 * Greedy MAP with a stop: each step takes the candidate with the largest
 * marginal value, quality discounted by its similarity to what's already
 * chosen, and stops when that value is under the bar (goal 11: never pads) or
 * the length cap is reached. Every exclusion says why.
 */

export interface PlanCandidate {
  id: string;
  /** The question or pattern it bears on; same topic = partly redundant. */
  topic: string;
  /** How well evidenced, 0..1 (counted, never claimed). */
  strength: number;
  /** Changed since the last episode. */
  moved?: boolean;
  /** Tied to one of the person's stated goals. */
  goalLinked?: boolean;
  /** Says the same thing as another candidate. */
  duplicateOf?: string;
  /** Behaviour, content, time, goals...: the same lens overlaps a little, so an
   *  episode isn't six patterns and nothing else (founder: the three lenses). */
  lens?: string;
}

export const BAR = 0.3;
export const MOVED_BONUS = 0.1;
export const GOAL_BONUS = 0.1;
/** How much a second item on the same topic is worth relative to the first. */
export const SAME_TOPIC_DISCOUNT = 0.5;
/** Overlap between two items through the same lens. Found 20 Oct: without it,
 *  21 live patterns pushed every shift, goal and content item past the cap. */
export const SAME_LENS_OVERLAP = 0.35;

export interface Plan { spine: string | null; selected: string[]; excluded: Record<string, string> }

export function quality(c: PlanCandidate): number {
  return Math.min(1, c.strength + (c.moved ? MOVED_BONUS : 0) + (c.goalLinked ? GOAL_BONUS : 0));
}

function similarity(a: PlanCandidate, b: PlanCandidate): number {
  if (a.duplicateOf === b.id || b.duplicateOf === a.id) return 1;
  if (a.topic === b.topic) return SAME_TOPIC_DISCOUNT;
  return a.lens && a.lens === b.lens ? SAME_LENS_OVERLAP : 0;
}

export function selectItems(candidates: PlanCandidate[], maxItems = 6): Plan {
  const excluded: Record<string, string> = {};
  const pool = [...candidates].sort((a, b) => quality(b) - quality(a) || a.id.localeCompare(b.id));
  const chosen: PlanCandidate[] = [];
  for (const c of pool) if (c.strength < BAR) excluded[c.id] = 'below the bar';
  let remaining = pool.filter((c) => !(c.id in excluded));

  while (remaining.length) {
    let best: PlanCandidate | null = null, bestValue = -1;
    for (const c of remaining) {
      // Overlap accumulates, as in a determinantal process: each further item
      // through the same lens is worth less than the last one was.
      const value = chosen.reduce((v, x) => v * (1 - similarity(c, x)), quality(c));
      if (value > bestValue) { best = c; bestValue = value; }
    }
    if (!best) break;
    if (chosen.length >= maxItems) { for (const c of remaining) excluded[c.id] = 'over the length cap (said in the episode: "and more I left out")'; break; }
    if (bestValue < BAR) {
      for (const c of remaining) {
        const dup = chosen.find((x) => similarity(c, x) === 1);
        excluded[c.id] = dup ? `duplicate of ${dup.id}` : 'not worth saying after what is already in';
      }
      break;
    }
    chosen.push(best);
    remaining = remaining.filter((c) => c.id !== best!.id);
  }
  return { spine: chosen[0]?.id ?? null, selected: chosen.map((c) => c.id), excluded };
}
