/**
 * Goal 21: what makes a hypothesis allowed to exist. Deterministic, because
 * a model must never be the only gate on the riskiest thing the product says.
 * See approach-calibration.md, goal 21.
 */

/** The closed catalogue: established, non-clinical, and mappable to evidence we hold. */
export const FRAMEWORKS = {
  sdt: { name: 'Self-determination theory', cite: 'Deci & Ryan; Ng et al. 2012 meta-analysis', wonders: 'which need (autonomy, competence, connection) an activity feeds' },
  flow: { name: 'Flow', cite: 'Csikszentmihalyi', wonders: 'where they are most absorbed' },
  intention_gap: { name: 'The intention–behaviour gap', cite: 'Sheeran 2002; Gollwitzer & Sheeran 2006', wonders: 'whether a plan lacks a when and where' },
  habit_cue: { name: 'Habits and context cues', cite: 'Wood & Neal 2007', wonders: 'whether a cue is driving a repeated behaviour' },
  approach_avoid: { name: 'Approach and avoidance goals', cite: 'Elliot & Thrash 2002', wonders: 'moving toward something, or away from something' },
} as const;
export type FrameworkId = keyof typeof FRAMEWORKS;

/**
 * Never clinical (goal 21): no diagnosis, disorder, trauma or pathology, not
 * hedged, not as a question, not ever. Matched on words and stems, so phrasing
 * it gently doesn't get it through.
 */
const CLINICAL = [
  /\bdepress/i, /\banxiety\b/i, /\bdisorder/i, /\bdisordered\b/i, /\badhd\b/i, /\badd\b/i, /\btrauma/i, /\bptsd\b/i,
  /\bbipolar\b/i, /\bmanic\b/i, /\bmania\b/i, /\bnarcissis/i, /\bocd\b/i, /\bobsessive/i, /\bcompulsive/i, /\baddict/i,
  /\bburnout\b/i, /\bautis/i, /\bspectrum\b/i, /\bpanic\b/i, /\bcodependen/i, /\binsomnia\b/i, /\bsymptom/i,
  /\bself[- ]medicat/i, /\bdissociat/i, /\battachment (issue|style|disorder)/i, /\bdiagnos/i, /\bpatholog/i, /\bsyndrome\b/i,
  /\bmental (illness|health condition)/i, /\btherap(y|ist)\b/i, /\bclinical\b/i, /\bsuicid/i, /\bself[- ]harm/i, /\beating\b/i,
];

export interface Proposal { framework: string; question: string; supports: number; sources: number; domainMaySpeak: boolean }

/** Pure: null when valid, otherwise the reason it can't exist. Clinical is checked first and is absolute. */
export function invalid(p: Proposal): string | null {
  if (CLINICAL.some((r) => r.test(p.question))) return 'clinical';
  if (!(p.framework in FRAMEWORKS)) return 'unknown framework';
  if (p.supports < 2 || p.sources < 2) return 'too little evidence';
  if (!p.question.trim().endsWith('?')) return 'not a question';
  if (!p.domainMaySpeak) return 'domain not ready';
  return null;
}
