import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyGoalIdOrDrop, sanitizeGoalId } from '../src/pipelines/legacy-shim';

/**
 * Every rejected value below is one that reached production and failed an
 * ingest run. Read from pipeline_run_traces on 18 October 2026.
 */

const GOAL = '11111111-1111-1111-1111-111111111111';
const known = new Set([GOAL]);

test('the prompt\'s own placeholder is never written as a goal id', () => {
  // The ingestion prompt's example output says "goal_id": "uuid-or-null", and
  // the model sometimes returns that string verbatim. In production this failed
  // runs with: invalid input syntax for type uuid: "uuid-or-null".
  assert.equal(sanitizeGoalId('uuid-or-null', known), null);
  assert.equal(sanitizeGoalId('null', known), null);
});

test('an id the model was never shown is not written, however real it looks', () => {
  // 23 production runs failed on a foreign-key violation: a well-formed uuid
  // for a goal that does not exist. Shape is not the test; membership is.
  assert.equal(sanitizeGoalId('22222222-2222-2222-2222-222222222222', known), null);
});

test('a goal the model was shown is kept', () => {
  assert.equal(sanitizeGoalId(GOAL, known), GOAL);
  assert.equal(sanitizeGoalId(`  ${GOAL}  `, known), GOAL, 'whitespace is not a reason to lose it');
});

test('anything that is not a string is not a goal id', () => {
  for (const value of [null, undefined, 42, {}, []]) {
    assert.equal(sanitizeGoalId(value, known), null);
  }
});

test('an observation with a bad goal is kept, unlinked', () => {
  // observations.goal_id is nullable -- 166 production rows have none. The
  // observation is still worth having.
  assert.deepEqual(legacyGoalIdOrDrop('observations', 'uuid-or-null', known), {
    keep: true,
    goalId: null,
  });
});

test('an insight with a bad goal is dropped, because it cannot be stored', () => {
  // insights.goal_id is NOT NULL. Writing null would fail the insert, and until
  // now a failed insert failed the whole ingest run -- facts and all.
  assert.deepEqual(legacyGoalIdOrDrop('insights', 'uuid-or-null', known), { keep: false });
});

test('an insight with a real goal is kept', () => {
  assert.deepEqual(legacyGoalIdOrDrop('insights', GOAL, known), { keep: true, goalId: GOAL });
});
