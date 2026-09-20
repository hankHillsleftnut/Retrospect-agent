import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignificance, isConfidentName, SIGNIFICANCE_HALF_LIFE_DAYS } from '../src/brain/people';

const NOW = new Date('2026-09-20T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString();

// ── Example C from the locked spec ───────────────────────────────────────────

test('Example C: the barista scores far below the manager', () => {
  const barista = computeSignificance({ mentions: [{ at: daysAgo(240) }], now: NOW });
  const manager = computeSignificance({
    mentions: Array.from({ length: 20 }, (_, i) => ({ at: daysAgo(i * 7) })),
    now: NOW,
  });
  assert.ok(manager > barista * 5, `manager ${manager} should dwarf barista ${barista}`);
  assert.ok(barista < 0.05, 'someone mentioned once, long ago, is near zero');
});

test('a person mentioned once is not given a rich profile by the score alone', () => {
  const once = computeSignificance({ mentions: [{ at: daysAgo(1) }], now: NOW });
  assert.ok(once < 0.3, 'one recent mention is still one mention');
});

// ── Recency is the point ─────────────────────────────────────────────────────

test('someone they stopped seeing fades below someone current', () => {
  const past = computeSignificance({
    mentions: Array.from({ length: 30 }, (_, i) => ({ at: daysAgo(300 + i * 7) })), now: NOW,
  });
  const present = computeSignificance({
    mentions: Array.from({ length: 8 }, (_, i) => ({ at: daysAgo(i * 7) })), now: NOW,
  });
  assert.ok(present > past,
    'without decay, an ex from two years ago outranks the person they live with');
});

test('a mention decays to about half over one half-life', () => {
  const fresh = computeSignificance({ mentions: [{ at: daysAgo(0) }], now: NOW });
  const aged = computeSignificance({
    mentions: [{ at: daysAgo(SIGNIFICANCE_HALF_LIFE_DAYS) }], now: NOW,
  });
  assert.ok(aged < fresh && aged > fresh * 0.35);
});

test('intensity raises the score, and the scale stays bounded', () => {
  const plain = computeSignificance({ mentions: [{ at: daysAgo(3) }], now: NOW });
  const intense = computeSignificance({ mentions: [{ at: daysAgo(3), intensity: 2 }], now: NOW });
  assert.ok(intense > plain);
  const flood = computeSignificance({
    mentions: Array.from({ length: 5000 }, () => ({ at: daysAgo(1) })), now: NOW,
  });
  assert.ok(flood <= 1, 'score must stay in 0..1 so thresholds keep meaning');
});

test('no mentions means no significance', () => {
  assert.equal(computeSignificance({ mentions: [], now: NOW }), 0);
});

// ── Identity: test 4 from the locked spec ────────────────────────────────────

test('a bare first name is never confident enough to merge on', () => {
  assert.equal(isConfidentName('Alex'), false);
  assert.equal(isConfidentName('  Sam  '), false);
});

test('a full name is', () => {
  assert.equal(isConfidentName('Alex Chen'), true);
  assert.equal(isConfidentName('Mary Anne Hobbs'), true);
});
