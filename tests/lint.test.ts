import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS, CHECKS_BY_ID, isSafety, fingerprint } from '../src/brain/lint-catalog';

// ── The admission test ──────────────────────────────────────────────────────

test('every check names the sentence a user would hear', () => {
  for (const c of CHECKS) {
    assert.ok(c.prevents && c.prevents.length > 20,
      `${c.id} has no user-facing sentence -- it is an ops metric, not lint`);
  }
});

test('every check names a remediation -- a finding nobody can act on is a complaint', () => {
  for (const c of CHECKS) {
    assert.ok(c.remediation && c.remediation.length > 10, `${c.id} has no remediation`);
  }
});

test('check ids are unique', () => {
  assert.equal(new Set(CHECKS.map((c) => c.id)).size, CHECKS.length);
});

test('severities are from the closed set', () => {
  for (const c of CHECKS) {
    assert.ok(['safety', 'bug', 'rot', 'info'].includes(c.severity), `${c.id}: ${c.severity}`);
  }
});

// ── Safety is not maintenance ───────────────────────────────────────────────

test('the two safety checks are the ones that could narrate a crisis', () => {
  const safety = CHECKS.filter((c) => c.severity === 'safety').map((c) => c.id);
  assert.deepEqual(safety.sort(), ['P5', 'W4']);
});

test('an extreme pattern marked episode-promotable is safety, not rot', () => {
  assert.equal(CHECKS_BY_ID['P5']!.severity, 'safety');
  assert.equal(isSafety('P5'), true);
});

test('a why on an extreme pattern is safety', () => {
  assert.equal(isSafety('W4'), true);
});

test('ordinary maintenance is never classed as safety', () => {
  for (const id of ['E3', 'P1', 'Po4', 'Po1']) assert.equal(isSafety(id), false);
});

// ── The checks that encode the documented failure ───────────────────────────

test('a why outliving its evidence is covered -- the identity_inferences failure', () => {
  assert.ok(CHECKS_BY_ID['W2']);
  assert.match(CHECKS_BY_ID['W2']!.prevents, /retired/);
});

test('a why on a pattern that never went live is a bug, not a nicety', () => {
  assert.equal(CHECKS_BY_ID['W1']!.severity, 'bug');
  assert.match(CHECKS_BY_ID['W1']!.prevents, /back door/);
});

test('duplicate facts are flagged because they corrupt the promotion bar', () => {
  assert.match(CHECKS_BY_ID['F6']!.prevents, /instance_count|promotion bar/);
});

test('P4 refuses to auto-merge patterns', () => {
  assert.match(CHECKS_BY_ID['P4']!.remediation, /ESCALATE|never auto-merge/i);
});

// ── Coverage of every layer ─────────────────────────────────────────────────

test('all six layers are checked', () => {
  const layers = new Set(CHECKS.map((c) => c.layer));
  assert.deepEqual([...layers].sort(),
    ['entities', 'facts', 'patterns', 'portrait', 'sources', 'whys']);
});

test('the catalog is the 26 checks the design specifies', () => {
  assert.equal(CHECKS.length, 26);
});

// ── Findings must be stable across runs ─────────────────────────────────────

test('the same finding fingerprints identically however the ids are ordered', () => {
  assert.equal(fingerprint('F6', ['b', 'a']), fingerprint('F6', ['a', 'b']),
    'a nightly run must update one row, not write a new one each time');
});

test('different subjects fingerprint differently', () => {
  assert.notEqual(fingerprint('F6', ['a']), fingerprint('F6', ['b']));
  assert.notEqual(fingerprint('F6', ['a']), fingerprint('F1', ['a']));
});

// ── Remediation scope ───────────────────────────────────────────────────────

test('checks needing a capability that does not exist yet are marked for A12', () => {
  const needNew = CHECKS.filter((c) => c.remediationIsNew).map((c) => c.id);
  assert.ok(needNew.length > 0);
  assert.ok(needNew.includes('F1'), 'machine-retire does not exist yet');
  assert.ok(needNew.includes('F6'), 'assertion merge does not exist yet');
});
