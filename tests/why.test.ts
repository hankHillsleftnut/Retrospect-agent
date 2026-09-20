import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canInferWhy, sanitizeWhy, shouldRetireWhy,
  MAX_WHY_CONFIDENCE, type PatternForWhy,
} from '../src/brain/why';

const live: PatternForWhy = {
  id: 'p1', status: 'live', severity: 'standard',
  instanceCount: 3, episodePromotable: true,
};

// ── Example A: the founder's stated fear, as a test ─────────────────────────

test('week 1 -- a candidate pattern gets NO why', () => {
  const gate = canInferWhy({ ...live, status: 'candidate', instanceCount: 1 });
  assert.equal(gate.allowed, false);
  assert.equal((gate as any).reason, 'pattern_not_live');
});

test('week 3 -- once the pattern is live, a why is allowed', () => {
  assert.equal(canInferWhy(live).allowed, true);
});

test('one bad day can never produce a psychological verdict', () => {
  for (const status of ['candidate', 'retired', 'user_rejected'] as const) {
    assert.equal(canInferWhy({ ...live, status, instanceCount: 1 }).allowed, false);
  }
});

// ── Safety ──────────────────────────────────────────────────────────────────

test('an extreme-severity pattern is never explained back to the person', () => {
  const gate = canInferWhy({ ...live, severity: 'extreme' });
  assert.equal(gate.allowed, false);
  assert.equal((gate as any).reason, 'extreme_severity');
});

test('a non-promotable pattern is refused even if severity looks ordinary', () => {
  assert.equal(canInferWhy({ ...live, episodePromotable: false }).allowed, false);
});

test('a pattern the user rejected is never re-theorised about', () => {
  const gate = canInferWhy({ ...live, status: 'user_rejected' });
  assert.equal((gate as any).reason, 'user_rejected');
});

test('belt and braces: a live pattern with one instance is still refused', () => {
  assert.equal(canInferWhy({ ...live, instanceCount: 1 }).allowed, false);
});

// ── A why cannot overclaim ──────────────────────────────────────────────────

test('confidence is clamped into the provisional range', () => {
  const hot = sanitizeWhy({ patternId: 'p1', mechanism: 'avoidance', confidence: 0.99 });
  assert.ok(hot.confidence <= MAX_WHY_CONFIDENCE, 'an inference must not sound certain');
  const cold = sanitizeWhy({ patternId: 'p1', mechanism: 'avoidance', confidence: -5 });
  assert.ok(cold.confidence > 0);
});

test('an invented mechanism falls back to unclear', () => {
  const w = sanitizeWhy({ patternId: 'p1', mechanism: 'shame_spiral_disorder' });
  assert.equal(w.mechanism, 'unclear', 'the vocabulary is closed on purpose');
});

test('a why carries the facts it reasoned from', () => {
  const w = sanitizeWhy({
    patternId: 'p1', mechanism: 'ambivalence', evidenceAssertionIds: ['a1', 'a2', 'a3'],
  });
  assert.deepEqual(w.evidenceAssertionIds, ['a1', 'a2', 'a3']);
});

// ── A conclusion must not outlive its evidence ──────────────────────────────

test('a why is retired when its pattern stops being live', () => {
  const r = shouldRetireWhy({ pattern: { ...live, status: 'retired' }, liveEvidenceCount: 3 });
  assert.equal(r.retire, true);
});

test('a why is retired when every supporting fact was retired', () => {
  const r = shouldRetireWhy({ pattern: live, liveEvidenceCount: 0 });
  assert.equal(r.retire, true);
  assert.match(r.reason!, /supporting facts/);
});

test('a healthy why stays', () => {
  assert.equal(shouldRetireWhy({ pattern: live, liveEvidenceCount: 3 }).retire, false);
});

test('a why is retired if its pattern is reclassified as extreme', () => {
  assert.equal(
    shouldRetireWhy({ pattern: { ...live, severity: 'extreme' }, liveEvidenceCount: 3 }).retire,
    true
  );
});
