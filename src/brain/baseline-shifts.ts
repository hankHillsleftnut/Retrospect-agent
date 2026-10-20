/**
 * "Your meeting hours doubled this week": this week against your own normal
 * (W3.4, analysis 6 in podcast-behaviour-analysis.md).
 *
 * Reads daily summaries (W3.1). For each metric, this week's days are compared
 * with the four weeks before. Pure; the output is candidates for the planner,
 * never facts about the person.
 *
 * Declared before looking at anyone's data (19 Oct):
 *  - Test: Mann-Whitney rank-sum (normal approximation, tie-corrected),
 *    two-sided p < 0.05. No assumption about how a metric is distributed.
 *  - Enough data: >= 4 days this week and >= 8 baseline days with a value.
 *  - Worth saying: the median moved by >= 25% as well. Real but tiny is noise
 *    to a listener.
 *  - Coverage: a domain counts from the first day it sent anything. Before
 *    that, an empty day is "not observed", not zero. After it, a day with no
 *    calendar events is a zero for event counts (that's the observation).
 */

import type { DailySummary } from './daily-summaries';

export const ALPHA = 0.05;
export const MIN_RECENT_DAYS = 4;
export const MIN_BASELINE_DAYS = 8;
export const MIN_CHANGE = 0.25;

interface MetricSpec { domain: DailySummary['domain']; metric: string; label: string; zeroWhenAbsent: boolean }

/** Metrics worth watching, and whether a covered day without a row means zero. */
export const METRICS: readonly MetricSpec[] = [
  { domain: 'calendar', metric: 'hours_booked', label: 'hours booked', zeroWhenAbsent: true },
  { domain: 'calendar', metric: 'with_others', label: 'meetings with other people', zeroWhenAbsent: true },
  { domain: 'calendar', metric: 'hours_focus', label: 'hours of focused work booked', zeroWhenAbsent: true },
  { domain: 'calendar', metric: 'hours_social', label: 'hours with friends booked', zeroWhenAbsent: true },
  { domain: 'calendar', metric: 'hours_exercise', label: 'hours of exercise booked', zeroWhenAbsent: true },
  { domain: 'own_words', metric: 'entries', label: 'entries you wrote', zeroWhenAbsent: true },
  { domain: 'mail', metric: 'sent', label: 'emails sent', zeroWhenAbsent: true },
  { domain: 'health', metric: 'steps', label: 'steps', zeroWhenAbsent: false },
  { domain: 'health', metric: 'sleep_hours', label: 'hours of sleep', zeroWhenAbsent: false },
  { domain: 'health', metric: 'exercise_minutes', label: 'minutes of exercise', zeroWhenAbsent: false },
];

export interface Shift {
  domain: string; metric: string; label: string;
  direction: 'up' | 'down';
  recentMedian: number; baselineMedian: number;
  change: number; p: number;
  recentDays: number; baselineDays: number;
  /** The summaries' items, so the claim is traceable. */
  sourceIds: string[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function normalTwoSided(z: number): number {
  // Abramowitz-Stegun 7.1.26 for erf; plenty for a 0.05 decision.
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 1 - erf;
}

/** Two-sided Mann-Whitney p-value, normal approximation with tie correction. */
export function mannWhitneyP(a: number[], b: number[]): number {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array<number>(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1]!.v === all[i]!.v) j++;
    const r = (i + j) / 2 + 1, t = j - i + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    tieTerm += t ** 3 - t;
    i = j + 1;
  }
  const n1 = a.length, n2 = b.length, n = n1 + n2;
  const r1 = all.reduce((s, x, i) => s + (x.g === 0 ? ranks[i]! : 0), 0);
  const u = r1 - (n1 * (n1 + 1)) / 2, mean = (n1 * n2) / 2;
  const variance = ((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1)));
  if (variance <= 0) return 1;
  const z = (Math.abs(u - mean) - 0.5) / Math.sqrt(variance);
  return Math.min(1, normalTwoSided(Math.max(0, z)));
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Shifts this week (the 7 days ending `today`) against the 28 before. */
export function baselineShifts(summaries: DailySummary[], today: string): Shift[] {
  const recentStart = addDays(today, -6), baseStart = addDays(today, -34);
  const out: Shift[] = [];
  for (const spec of METRICS) {
    const rows = summaries.filter((s) => s.domain === spec.domain);
    if (!rows.length) continue;
    const firstSeen = rows.map((r) => r.day).sort()[0]!;
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const recent: number[] = [], base: number[] = [], ids: string[] = [];
    for (let d = baseStart; d <= today; d = addDays(d, 1)) {
      if (d < firstSeen) continue;
      const row = byDay.get(d);
      const raw = row?.metrics[spec.metric];
      const v = typeof raw === 'number' ? raw : spec.zeroWhenAbsent ? 0 : null;
      if (v === null) continue;
      if (d >= recentStart) { recent.push(v); if (row) ids.push(...row.source_ids); } else base.push(v);
    }
    if (recent.length < MIN_RECENT_DAYS || base.length < MIN_BASELINE_DAYS) continue;
    const rm = median(recent), bm = median(base);
    const change = bm === 0 ? (rm === 0 ? 0 : Infinity) : (rm - bm) / bm;
    if (Math.abs(change) < MIN_CHANGE) continue;
    const p = mannWhitneyP(recent, base);
    if (p >= ALPHA) continue;
    out.push({ domain: spec.domain, metric: spec.metric, label: spec.label, direction: rm > bm ? 'up' : 'down',
      recentMedian: rm, baselineMedian: bm, change: Number.isFinite(change) ? Math.round(change * 100) / 100 : change,
      p: Math.round(p * 1000) / 1000, recentDays: recent.length, baselineDays: base.length, sourceIds: ids });
  }
  return out;
}
