import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeDocument } from '../src/brain/complete-document';

/** Found by the end-to-end test: a facts-built portrait lacked sections, and the first episode crashed. */

test('a portrait missing sections gets empty ones, keeping what it has', () => {
  const doc = completeDocument({ identity_core: 'Builds things.' } as any)!;
  assert.equal(doc.identity_core, 'Builds things.');
  assert.deepEqual(doc.active_goals, []);
  assert.deepEqual(doc.live_tensions, []);
  assert.deepEqual(doc.emerging_dimensions, []);
  assert.equal(doc.forward_focus, '');
});

test('sections of the wrong shape are treated as empty, not trusted', () => {
  const doc = completeDocument({ active_goals: 'not a list', live_tensions: null } as any)!;
  assert.deepEqual(doc.active_goals, []);
  assert.deepEqual(doc.live_tensions, []);
});

test('no portrait stays no portrait', () => {
  assert.equal(completeDocument(null), null);
  assert.equal(completeDocument(undefined), null);
});

test('a complete portrait is unchanged', () => {
  const full = { identity_core: 'x', active_goals: [{ goal_id: null, title: 't', what_its_really_about: 'w' }], behavioral_patterns: 'b',
    emotional_baseline: 'e', live_tensions: ['l'], track_record: 'r', forward_focus: 'f', emerging_dimensions: [] };
  assert.deepEqual(completeDocument(full as any), full);
});
