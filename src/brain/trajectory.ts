/**
 * Is a pattern weakening, holding or getting stronger? (W3.3, goal 25)
 *
 * Two windows (by default the last 28 days and the 28 before), instance counts
 * in each, and an exact test of whether the rate changed: conditional on the
 * total, the recent count is binomial with p = recent time / total time when
 * nothing changed (the classical comparison of two Poisson rates).
 *
 * Declared before running on anyone's data (19 Oct):
 *  - A change is claimed only at two-sided p < 0.05. "This is breaking" needs
 *    the same care as "this exists" (goal 25), so the claim side is strict.
 *  - "Holding" needs at least 3 instances in each window and a rate ratio
 *    between 2/3 and 3/2. Anything else is "not enough to say".
 *  - It must be able to say a pattern got worse (goal 25): strengthening is
 *    reported exactly like weakening.
 * The counts travel with the verdict, so every trajectory claim is traceable
 * to instance counts ("twice this month, five times last").
 */

export type Trajectory = 'weakening' | 'holding' | 'strengthening' | 'insufficient';

export const ALPHA = 0.05;
export const HOLDING_MIN_EACH = 3;
export const HOLDING_RATIO: readonly [number, number] = [2 / 3, 3 / 2];

export interface TrajectoryResult {
  trajectory: Trajectory;
  prior: number;
  recent: number;
  priorDays: number;
  recentDays: number;
  /** Two-sided exact p-value; 1 when there's nothing to test. */
  p: number;
  /** Recent rate over prior rate; null when the prior window is empty. */
  ratio: number | null;
}

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** P(X >= k) or P(X <= k) for X ~ Binomial(n, p). */
function binomialTail(n: number, p: number, k: number, upper: boolean): number {
  let total = 0;
  const lo = upper ? k : 0, hi = upper ? n : k;
  for (let i = lo; i <= hi; i++) total += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log1p(-p));
  return Math.min(1, total);
}

export function trajectoryOf(prior: number, recent: number, priorDays = 28, recentDays = 28): TrajectoryResult {
  const n = prior + recent;
  const ratio = prior > 0 ? (recent / recentDays) / (prior / priorDays) : null;
  const base = { prior, recent, priorDays, recentDays, ratio: ratio === null ? null : Math.round(ratio * 100) / 100 };
  if (n === 0) return { ...base, trajectory: 'insufficient', p: 1 };

  const p0 = recentDays / (priorDays + recentDays);
  const up = recent / recentDays > prior / priorDays;
  const p = Math.min(1, 2 * binomialTail(n, p0, recent, up));

  let trajectory: Trajectory;
  if (p < ALPHA) trajectory = up ? 'strengthening' : 'weakening';
  else if (prior >= HOLDING_MIN_EACH && recent >= HOLDING_MIN_EACH && ratio !== null && ratio >= HOLDING_RATIO[0] && ratio <= HOLDING_RATIO[1]) trajectory = 'holding';
  else trajectory = 'insufficient';
  return { ...base, trajectory, p: Math.round(p * 1000) / 1000 };
}

/** Counts in each window from instance times. `now` ends the recent window. */
export function windowCounts(times: string[], now: Date, recentDays = 28, priorDays = 28): { prior: number; recent: number } {
  const end = now.getTime(), split = end - recentDays * 864e5, start = split - priorDays * 864e5;
  let prior = 0, recent = 0;
  for (const t of times) {
    const ms = new Date(t).getTime();
    if (ms > split && ms <= end) recent++;
    else if (ms > start && ms <= split) prior++;
  }
  return { prior, recent };
}
