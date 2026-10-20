/** Regression tests for the review of #57-#84 (19 Oct). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAll, chunks } from '../src/db/paged';
import { planLifecycle, type GoalRow } from '../src/goals/lifecycle';
import { handleArrivals } from '../src/events/arrivals';

test('selectAll reads past the 1,000-row page, and stops on a short page', async () => {
  const all = Array.from({ length: 2345 }, (_, i) => i);
  const calls: Array<[number, number]> = [];
  const got = await selectAll<number>(async (from, to) => { calls.push([from, to]); return { data: all.slice(from, to + 1), error: null }; });
  assert.equal(got.length, 2345);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('chunks split long id lists', () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('a goal stated again restarts its 90 days instead of expiring the next day', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const g = (status_at: string | null): GoalRow => ({ id: 'g', title: 'Run a marathon', description: null, created_at: '2026-06-01T00:00:00Z', updated_at: null, vector: null, status_at });
  assert.deepEqual(planLifecycle([g('2026-10-19T00:00:00Z')], [], now).expire, [], 'revived yesterday');
  assert.deepEqual(planLifecycle([g(null)], [], now).expire, ['g'], 'never revived');
});

test('a failure to release one claim does not stop the others', async () => {
  const done: string[] = [];
  const r = await handleArrivals({
    claim: async () => [{ user_id: 'a', claimed_at: 't', arrivals: 1 }, { user_id: 'b', claimed_at: 't', arrivals: 1 }],
    mayRun: async () => true,
    read: async (u) => { if (u === 'a') throw new Error('read failed'); },
    research: async () => {},
    finish: async (c, ok) => { if (!ok) throw new Error('release failed'); done.push(c.user_id); return 'done'; },
  });
  assert.deepEqual(r.map((x) => x.outcome), ['deferred', 'done']);
  assert.deepEqual(done, ['b']);
});
