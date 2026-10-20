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

import { categoriseByRule, vetPlacements, titleKey } from '../src/brain/time-categories';
import { placeUnrecognisedEvents } from '../src/brain/place-events';
import { rebuildDailySummaries } from '../src/brain/daily-summaries';
import { freshDatabase, insertUser } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

test('W3.5b: a cached answer fills only what the rules left; a person\'s correction always wins', () => {
  const cache = new Map([[titleKey('Atelier'), { category: 'learning' as const, decided_by: 'model' }], [titleKey('Gym'), { category: 'social' as const, decided_by: 'model' }], [titleKey('Run club'), { category: 'social' as const, decided_by: 'person' }]]);
  assert.equal(categoriseEvent({ title: 'atelier ' }, cache), 'learning');
  assert.equal(categoriseEvent({ title: 'Gym' }, cache), 'exercise', 'the model never overrides a rule');
  assert.equal(categoriseEvent({ title: 'Run club' }, cache), 'social', 'the person overrides everything');
  assert.equal(categoriseByRule({ title: 'Run club' }), 'exercise');
});

test('W3.5b: only well-formed answers for asked titles are kept', () => {
  const got = vetPlacements(['Atelier', 'Mystery'], { placed: [{ i: 0, category: 'learning' }, { i: 1, category: 'vibes' }, { i: 7, category: 'social' }] });
  assert.deepEqual([...got], [['atelier', 'learning']]);
});

test('W3.5b, against the database: unplaced titles are asked once, cached, and used by the summaries', async () => {
  const { db } = await freshDatabase();
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const user = await insertUser(db);
  const conn = (await db.query<{ id: string }>(`INSERT INTO integration_connections (user_id, provider_id, collection_mode) VALUES ($1, 'google_calendar', 'oauth_api') RETURNING id`, [user])).rows[0]!.id;
  const event = async (title: string, start: string, end: string) => {
    const si = (await db.query<{ id: string }>(`INSERT INTO source_items (user_id, connection_id, provider_object_type, provider_object_id, canonical_type, normalized_data, occurred_at, normalizer_version)
      VALUES ($1, $2, 'calendar_event', $3, 'calendar_event', $4, $5, 't') RETURNING id`,
      [user, conn, `${title}-${start}`, JSON.stringify({ title, start, end, all_day: false, attendee_count: 0, my_response: 'accepted', busy: true }), start])).rows[0]!.id;
    await db.query(`INSERT INTO raw_content (user_id, content_type, content, created_at, source_item_id) VALUES ($1, 'calendar', $2, $3, $4)`, [user, `Calendar event: ${title}`, start, si]);
  };
  await event('Atelier', '2026-10-14T10:00:00-07:00', '2026-10-14T13:00:00-07:00');
  await event('Atelier', '2026-10-15T10:00:00-07:00', '2026-10-15T13:00:00-07:00');
  await event('Gym', '2026-10-14T07:00:00-07:00', '2026-10-14T08:00:00-07:00');
  await event('Mystery', '2026-10-15T15:00:00-07:00', '2026-10-15T16:00:00-07:00');

  const asked: string[][] = [];
  const model = async (_s: string, prompt: string) => {
    asked.push(prompt.split('\n'));
    return { data: { placed: [{ i: prompt.split('\n').findIndex((l) => l.endsWith('Atelier')), category: 'learning' }] }, usage: { inputTokens: 10, outputTokens: 5 } };
  };
  const r = await placeUnrecognisedEvents(user, supabase, model);
  assert.deepEqual(r, { asked: 2, placed: 1, usage: { inputTokens: 10, outputTokens: 5 } }, 'Atelier asked once though it occurs twice; Gym never asked');
  assert.equal((await placeUnrecognisedEvents(user, supabase, model)).asked, 0, 'never asked twice');

  await rebuildDailySummaries(user, 30, supabase, new Date('2026-10-19T12:00:00Z'));
  const { rows } = await db.query<{ day: string; metrics: Record<string, number> }>(`SELECT day::text, metrics FROM daily_summaries WHERE user_id = $1 AND domain = 'calendar' ORDER BY day`, [user]);
  assert.deepEqual(rows.map((x) => [x.day, x.metrics.hours_learning, x.metrics.hours_other ?? 0]), [['2026-10-14', 3, 0], ['2026-10-15', 3, 1]]);
});
