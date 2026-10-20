/** D1.2: what you sent comes first and always; the rest is selected; quiet days stay quiet. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDaily, toInbox, SENT_TYPES } from '../src/planner/daily';
import type { UnderstandingContract } from '../src/understanding/read';

const contract = (over: Partial<UnderstandingContract> = {}): UnderstandingContract => ({
  userId: 'u', asOf: '2026-10-20', answers: [], silent: [], patterns: [], whys: [], goals: [], shifts: [],
  time: { categories: [], otherShare: 0, weeksOfBaseline: 4 }, moves: { since: null, items: [] }, ...over,
});

test('everything sent since the last brief is in, oldest first, with its link pulled out', () => {
  const inbox = [
    toInbox({ id: 'b', content_type: 'text_entry', created_at: '2026-10-20T09:00:00Z', content: 'Read this later https://example.com/essay ok' }),
    toInbox({ id: 'a', content_type: 'text_entry', created_at: '2026-10-19T22:00:00Z', content: 'note to self' }),
  ];
  const p = planDaily(contract(), { inbox, today: [], saidRecently: new Set() });
  assert.deepEqual(p.inbox.map((i) => [i.id, i.url]), [['a', null], ['b', 'https://example.com/essay']]);
  assert.equal(p.quiet, false, 'something sent is never a quiet day');
});

test('a day with nothing sent and nothing worth saying is quiet', () => {
  assert.equal(planDaily(contract(), { inbox: [], today: [], saidRecently: new Set() }).quiet, true);
});

test('static patterns stay out of the daily brief; a shift said yesterday loses to a fresh one', () => {
  const shift = (metric: string) => ({ domain: 'health', metric, label: metric, direction: 'up' as const, recentMedian: 2, baselineMedian: 1, change: 1, p: 0.01, recentDays: 5, baselineDays: 25, sourceIds: [] });
  const p = planDaily(contract({
    patterns: [{ kind: 'pattern', id: 'p', label: 'x', confidence: 0.9, instances: 9, firstSeenAt: null, lastSeenAt: null, trajectory: 'insufficient', trajectoryDetail: null, register: 'stated' }],
    shifts: [shift('steps'), shift('sleep_hours')],
  }), { inbox: [], today: [], saidRecently: new Set(['shift:health:steps']) });
  assert.ok(!p.items.some((i) => i.kind === 'pattern'), 'a pattern that did not move is weekly material, not daily');
  assert.equal(p.items[0]!.id, 'shift:health:sleep_hours');
});

test('passive syncs are not "sent"', () => {
  for (const t of ['calendar', 'healthkit', 'gmail', 'youtube', 'google_docs']) assert.equal(SENT_TYPES.has(t), false, t);
});
