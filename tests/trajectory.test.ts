/** W3.3: pattern trajectory against the gate cases declared before code (#54). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trajectoryOf, windowCounts } from '../src/brain/trajectory';

const gate = JSON.parse(readFileSync('tests/fixtures/gates/w3-trajectory.json', 'utf8')) as {
  cases: Array<{ id: string; prior: number; recent: number; recent_days?: number; expect: string }>;
};

test('gate W3: >= 80% of cases right, and 0 change claims the evidence does not support', () => {
  const results = gate.cases.map((c) => ({ c, got: trajectoryOf(c.prior, c.recent, 28, c.recent_days ?? 28).trajectory }));
  const right = results.filter((r) => r.got === r.c.expect).length;
  const unsupported = results.filter((r) => (r.got === 'weakening' || r.got === 'strengthening') && r.got !== r.c.expect);
  assert.deepEqual(unsupported, []);
  assert.ok(right / results.length >= 0.8, `${right}/${results.length}`);
  // The known misses, recorded so a change in either direction is noticed: both
  // say "not enough to say yet" where the case hoped for a change (p 0.06, 0.30).
  assert.deepEqual(results.filter((r) => r.got !== r.c.expect).map((r) => `${r.c.id}:${r.got}`), ['r11:insufficient', 'r12:insufficient']);
});

test('it can say a pattern got worse, and says so the same way', () => {
  assert.equal(trajectoryOf(3, 14).trajectory, 'strengthening');
  assert.equal(trajectoryOf(14, 3).trajectory, 'weakening');
});

test('the counts travel with the verdict', () => {
  assert.deepEqual(trajectoryOf(12, 2), { trajectory: 'weakening', prior: 12, recent: 2, priorDays: 28, recentDays: 28, ratio: 0.17, p: 0.013 });
});

test('instances fall into the right window', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  assert.deepEqual(windowCounts(['2026-10-18T00:00:00Z', '2026-09-30T00:00:00Z', '2026-09-10T00:00:00Z', '2026-07-01T00:00:00Z'], now), { prior: 1, recent: 2 });
});
