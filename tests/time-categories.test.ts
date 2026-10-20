/** W3.5: where the time went. Gate: hours add up to hours booked; nothing is in two categories. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoriseEvent, weekTime, TIME_CATEGORIES } from '../src/brain/time-categories';
import { summariseDays, type SummaryItem } from '../src/brain/daily-summaries';

test('declared rules put plain events where a person would', () => {
  const cases: Array<[string, number, string]> = [
    ['Climbing with Priya', 1, 'exercise'], ['Physio, Dr. Lee', 0, 'health'], ['Woodworking class, Laney College', 0, 'learning'],
    ['Flight to NYC', 0, 'travel'], ['Dinner with Priya', 1, 'social'], ['Deep work: pitch deck', 0, 'focus'],
    ['1:1 with Dana', 1, 'meetings'], ['Investor call', 2, 'meetings'], ['Haircut', 0, 'personal'],
    ['Q4 planning', 4, 'meetings'], ['Untitled', 3, 'meetings'], ['Thing', 0, 'other'],
  ];
  for (const [title, attendees, want] of cases) assert.equal(categoriseEvent({ title, attendee_count: attendees }), want, title);
});

test('gate: category hours add up to the hours booked, and each event is in exactly one', () => {
  const ev = (title: string, start: string, end: string, attendee_count = 0): SummaryItem => ({
    id: title, content_type: 'calendar', created_at: start, occurred_at: start,
    normalized_data: { title, start, end, all_day: false, attendee_count, my_response: 'accepted', busy: true },
  });
  const [d] = summariseDays([
    ev('Gym', '2026-10-14T07:00:00-07:00', '2026-10-14T08:00:00-07:00'),
    ev('Standup', '2026-10-14T09:00:00-07:00', '2026-10-14T09:15:00-07:00', 6),
    ev('Deep work', '2026-10-14T10:00:00-07:00', '2026-10-14T13:00:00-07:00'),
    ev('Dinner with Sam', '2026-10-14T19:00:00-07:00', '2026-10-14T21:00:00-07:00', 1),
  ]);
  const m = d!.metrics as Record<string, number>;
  const sum = TIME_CATEGORIES.reduce((s, c) => s + (m[`hours_${c}`] ?? 0), 0);
  assert.equal(Math.round(sum * 100) / 100, 6.25);
  assert.deepEqual([m.hours_exercise, m.hours_meetings, m.hours_focus, m.hours_social], [1, 0.25, 3, 2]);
});

test('a week beside the usual week; a calendar connected two weeks ago is averaged over two, not four', () => {
  const day = (o: number) => new Date(Date.parse('2026-10-19T00:00:00Z') - o * 864e5).toISOString().slice(0, 10);
  const s = [
    ...[7, 9, 11, 13, 15, 17, 19, 20].map((o) => ({ day: day(o), domain: 'calendar' as const, items: 1, source_ids: [], metrics: { hours_meetings: 2 } })),
    ...[0, 1, 2].map((o) => ({ day: day(o), domain: 'calendar' as const, items: 1, source_ids: [], metrics: { hours_meetings: 4, hours_other: 1 } })),
  ];
  const w = weekTime(s, '2026-10-19');
  assert.equal(w.weeksOfBaseline, 2);
  assert.deepEqual(w.categories.find((c) => c.category === 'meetings'), { category: 'meetings', thisWeek: 12, usualWeek: 8 });
  assert.equal(w.otherShare, 0.2);
});
