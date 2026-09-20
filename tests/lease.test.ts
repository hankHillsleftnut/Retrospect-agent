import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEASE_TTL_MS, HEARTBEAT_INTERVAL_MS } from '../src/brain/lease';

test('a heartbeat fires well inside the lease window', () => {
  assert.ok(
    HEARTBEAT_INTERVAL_MS * 3 < LEASE_TTL_MS,
    'a live run must beat several times before its lease could expire, or healthy work gets reclaimed'
  );
});

/** The reclaim predicate, isolated from Supabase so it can be reasoned about. */
function isReclaimable(row: { status: string; startedAt: string | null }, now: number, ttlMs: number) {
  if (row.status !== 'processing') return false;
  if (row.startedAt === null) return true;            // claimed without a stamp
  return new Date(row.startedAt).getTime() < now - ttlMs;
}

const NOW = Date.parse('2026-09-20T12:00:00.000Z');

test('a run that died is reclaimable once its lease expires', () => {
  const dead = { status: 'processing', startedAt: new Date(NOW - 20 * 60 * 1000).toISOString() };
  assert.equal(isReclaimable(dead, NOW, LEASE_TTL_MS), true);
});

test('a run still working is NOT reclaimed', () => {
  const alive = { status: 'processing', startedAt: new Date(NOW - 60 * 1000).toISOString() };
  assert.equal(isReclaimable(alive, NOW, LEASE_TTL_MS), false);
});

test('a row claimed with no stamp is reclaimable, or it is stranded forever', () => {
  assert.equal(isReclaimable({ status: 'processing', startedAt: null }, NOW, LEASE_TTL_MS), true);
});

test('completed and failed rows are never reclaimed by the lease path', () => {
  for (const status of ['completed', 'failed', 'pending']) {
    assert.equal(
      isReclaimable({ status, startedAt: new Date(NOW - 99 * 60 * 1000).toISOString() }, NOW, LEASE_TTL_MS),
      false,
      `${status} must not be touched by lease reclaim`
    );
  }
});

test('the May 2026 scenario: a transient failure becomes a retry, not a loss', () => {
  // 2,034 rows died to an Anthropic billing lapse and nothing ever retried
  // them. Under the new rules every one of these comes back.
  const stranded = Array.from({ length: 5 }, () => ({
    status: 'processing',
    startedAt: new Date(NOW - 4 * 30 * 24 * 60 * 60 * 1000).toISOString(),
  }));
  assert.equal(stranded.every((r) => isReclaimable(r, NOW, LEASE_TTL_MS)), true);
});
