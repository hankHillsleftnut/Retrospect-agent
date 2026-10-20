/**
 * Where the time went: a category for each calendar event (W3.5, the time lens).
 *
 * Rules only, declared before looking at anyone's calendar (19 Oct). Auditable
 * and free. An event no rule recognises is "other", reported as such and never
 * guessed; the share of "other" is the measure of whether a model pass is
 * worth adding later.
 *
 * Order matters: the first matching rule wins, most specific first.
 */

import type { DailySummary } from './daily-summaries';

export const TIME_CATEGORIES = ['exercise', 'health', 'learning', 'travel', 'social', 'meetings', 'focus', 'personal', 'other'] as const;
export type TimeCategory = (typeof TIME_CATEGORIES)[number];

const RULES: Array<[TimeCategory, RegExp]> = [
  ['exercise', /\b(gym|run|running|jog|climb(ing)?|yoga|pilates|swim(ming)?|workout|lift(ing)?|bike|cycling|hike|hiking|tennis|soccer|basketball|crossfit|boxing|spin)\b/i],
  ['health', /\b(doctor|dr\.?|dentist|physio|therapy|therapist|clinic|appointment with dr|checkup|check-up|hospital|pharmacy|psychiatrist|counsel(l)?ing)\b/i],
  ['learning', /\b(class|course|lecture|seminar|workshop|lesson|tutorial|study|office hours|section|exam|midterm|final)\b/i],
  ['travel', /\b(flight|fly|airport|train|drive to|travel|trip|uber to|layover|check-?in|hotel)\b/i],
  ['social', /\b(dinner|lunch|brunch|drinks|coffee with|party|birthday|wedding|hang|date|bbq|game night|catch up|catch-up)\b/i],
  ['focus', /\b(focus|deep work|heads? down|block|build|write|writing|coding|design time|no meetings)\b/i],
  ['meetings', /\b(meeting|sync|1:1|1-1|one on one|standup|stand-up|interview|call|review|retro|planning|demo|pitch|investor|board)\b/i],
  ['personal', /\b(haircut|errand|groceries|laundry|clean|move|moving|bank|dmv|personal)\b/i],
];

export interface EventForCategory { title?: string | null; attendee_count?: number | null }

/** How a title is looked up in the cache: case and spacing don't matter. */
export const titleKey = (title: string | null | undefined) => (title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The category for one event. A cached decision (the person's, or the model's
 * for a title the rules couldn't place) is used only when the rules say
 * "other", except a person's correction, which always wins.
 */
export function categoriseEvent(e: EventForCategory, cached?: Map<string, { category: TimeCategory; decided_by: string }>): TimeCategory {
  const hit = cached?.get(titleKey(e.title));
  if (hit?.decided_by === 'person') return hit.category;
  const byRule = categoriseByRule(e);
  return byRule === 'other' && hit ? hit.category : byRule;
}

export function categoriseByRule(e: EventForCategory): TimeCategory {
  const title = (e.title ?? '').trim();
  for (const [category, rule] of RULES) if (rule.test(title)) return category;
  // Unrecognised, but other people are invited: it's a meeting of some kind.
  if ((e.attendee_count ?? 0) > 0) return 'meetings';
  return 'other';
}


export interface WeekTime {
  category: TimeCategory;
  thisWeek: number;
  /** Average hours a week over the four weeks before. */
  usualWeek: number;
}

const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * Hours booked per category this week (7 days ending `today`) beside the
 * person's usual week. Only booked calendar time: a day isn't fully observed,
 * so this never claims what the rest of the day held.
 */
export function weekTime(summaries: DailySummary[], today: string): { categories: WeekTime[]; otherShare: number; weeksOfBaseline: number } {
  const recentStart = shiftDay(today, -6), baseStart = shiftDay(today, -34);
  const cal = summaries.filter((s) => s.domain === 'calendar' && s.day >= baseStart && s.day <= today);
  const firstSeen = summaries.filter((s) => s.domain === 'calendar').map((s) => s.day).sort()[0];
  const baselineDays = firstSeen ? Math.max(0, Math.min(28, (Date.parse(recentStart) - Date.parse(firstSeen > baseStart ? firstSeen : baseStart)) / 864e5)) : 0;
  const weeksOfBaseline = Math.round((baselineDays / 7) * 10) / 10;
  const categories = TIME_CATEGORIES.map((category) => {
    let thisWeek = 0, before = 0;
    for (const s of cal) {
      const h = Number(s.metrics[`hours_${category}`] ?? 0);
      if (s.day >= recentStart) thisWeek += h; else before += h;
    }
    return { category, thisWeek: Math.round(thisWeek * 10) / 10, usualWeek: weeksOfBaseline ? Math.round((before / weeksOfBaseline) * 10) / 10 : 0 };
  }).filter((c) => c.thisWeek > 0 || c.usualWeek > 0);
  const total = categories.reduce((s, c) => s + c.thisWeek, 0);
  const other = categories.find((c) => c.category === 'other')?.thisWeek ?? 0;
  return { categories, otherShare: total ? Math.round((other / total) * 100) / 100 : 0, weeksOfBaseline };
}

// ── Placing what the rules couldn't (W3.5b) ─────────────────────────────────

export const PLACE_SYSTEM = `You place calendar events into one category each, by title alone.
Categories: exercise, health, learning, travel, social, meetings, focus, personal, other.
- meetings: work or group calls and meetings. focus: time blocked to work alone.
- social: time with friends or family. personal: errands, chores, admin.
- If the title doesn't make it clear, answer "other". Never guess.
Reply with JSON only: {"placed":[{"i":<number>,"category":"<category>"}]}`;

export function placePrompt(titles: string[]): string {
  return titles.map((t, i) => `${i}: ${t}`).join('\n');
}

/** Keep only well-formed answers for titles that were asked about. Pure. */
export function vetPlacements(titles: string[], reply: { placed?: Array<{ i?: unknown; category?: unknown }> }): Map<string, TimeCategory> {
  const out = new Map<string, TimeCategory>();
  for (const p of reply.placed ?? []) {
    const i = Number(p.i);
    if (!Number.isInteger(i) || i < 0 || i >= titles.length) continue;
    if (!(TIME_CATEGORIES as readonly string[]).includes(String(p.category))) continue;
    out.set(titleKey(titles[i]), p.category as TimeCategory);
  }
  return out;
}
