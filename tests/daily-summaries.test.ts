/** W3.1: the shape of each day. Gate: numbers add up to their items, nothing counted twice, local days. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseDays, usualOffset, localTime, type SummaryItem } from '../src/brain/daily-summaries';

let n = 0;
const ev = (start: string, end: string, extra: Record<string, unknown> = {}): SummaryItem => ({
  id: `c${++n}`, content_type: 'calendar', created_at: '2026-10-19T00:00:00Z', occurred_at: start,
  normalized_data: { start, end, all_day: false, attendee_count: 0, my_response: 'accepted', busy: true, ...extra },
});
const words = (created_at: string, chars = 100, extra: Partial<SummaryItem> = {}): SummaryItem =>
  ({ id: `w${++n}`, content_type: 'journal_entry', created_at, chars, trust_class: 'own_words', ...extra });

test('calendar: a day is booked hours, with others, declined and first/last, in local time', () => {
  const days = summariseDays([
    ev('2026-10-14T09:00:00-07:00', '2026-10-14T10:30:00-07:00', { attendee_count: 3 }),
    ev('2026-10-14T13:00:00-07:00', '2026-10-14T14:00:00-07:00', { my_response: 'declined' }),
    ev('2026-10-14T23:00:00-07:00', '2026-10-14T23:45:00-07:00'),
    { ...ev('2026-10-14', '2026-10-15'), normalized_data: { start: '2026-10-14T00:00:00Z', end: '2026-10-15T00:00:00Z', all_day: true } },
  ]);
  assert.equal(days.length, 1, 'the 11pm event stays on the 14th, though it is the 15th in UTC');
  assert.deepEqual(days[0], {
    day: '2026-10-14', domain: 'calendar', items: 4, source_ids: days[0]!.source_ids,
    metrics: { events: 4, hours_booked: 2.3, with_others: 1, declined: 1, all_day: 1, first_start: '09:00', last_end: '23:45' },
  });
});

test('own words land on the local day of the person\'s usual offset; automated mail-in text does not count', () => {
  const items = [
    ev('2026-10-10T10:00:00-07:00', '2026-10-10T11:00:00-07:00'),
    words('2026-10-15T06:30:00Z', 250),
    words('2026-10-15T08:00:00Z', 50),
    words('2026-10-15T09:00:00Z', 999, { trust_class: 'automated' }),
  ];
  assert.equal(usualOffset(items), -420);
  const own = summariseDays(items).filter((d) => d.domain === 'own_words');
  assert.deepEqual(own.map((d) => [d.day, d.metrics]), [
    ['2026-10-14', { entries: 1, chars: 250, first_at: '23:30', last_at: '23:30' }],
    ['2026-10-15', { entries: 1, chars: 50, first_at: '01:00', last_at: '01:00' }],
  ]);
});

test('mail counts received, sent and automated', () => {
  const m = (labels: string[], trust = 'third_party'): SummaryItem =>
    ({ id: `m${++n}`, content_type: 'gmail', created_at: '2026-10-18T18:00:00Z', occurred_at: '2026-10-18T18:00:00Z', trust_class: trust, metadata: { labels } });
  const [d] = summariseDays([m(['INBOX']), m(['SENT']), m(['INBOX', 'CATEGORY_PROMOTIONS'], 'automated')], 0);
  assert.deepEqual(d!.metrics, { received: 2, sent: 1, automated: 1 });
});

test('liked videos are left out (their date is when the video was published); subscriptions count', () => {
  const yt = (relationship: string, at: string): SummaryItem =>
    ({ id: `y${++n}`, content_type: 'youtube', created_at: '2026-10-19T00:00:00Z', occurred_at: at, metadata: { relationship } });
  const days = summariseDays([yt('liked', '2007-09-02T00:00:00Z'), yt('subscribed_to', '2026-10-01T12:00:00Z')], 0);
  assert.deepEqual(days.map((d) => [d.day, d.domain, d.metrics]), [['2026-10-01', 'content', { subscribed: 1 }]]);
});

test('gate: every summarised item is counted exactly once, and the counts add up', () => {
  const items: SummaryItem[] = [];
  for (let d = 1; d <= 20; d++) {
    const day = `2026-09-${String(d).padStart(2, '0')}`;
    items.push(ev(`${day}T08:00:00-07:00`, `${day}T09:00:00-07:00`), words(`${day}T20:00:00Z`));
    if (d % 3 === 0) items.push(ev(`${day}T22:00:00-07:00`, `${day}T23:59:00-07:00`));
  }
  const days = summariseDays(items);
  const ids = days.flatMap((d) => d.source_ids);
  assert.equal(new Set(ids).size, ids.length, 'no item in two summaries');
  assert.equal(ids.length, items.length, 'every item summarised');
  assert.equal(days.reduce((s, d) => s + d.items, 0), items.length);
});

test('local time helper', () => {
  assert.deepEqual(localTime('2026-10-15T06:30:00Z', -420), { day: '2026-10-14', minute: 23 * 60 + 30 });
});
