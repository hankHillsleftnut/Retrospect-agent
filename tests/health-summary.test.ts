import assert from 'node:assert/strict';
import test from 'node:test';
import { recordedReadingsOnly, isHealthSummary, normalizeHealthSummary } from '../src/pipelines/health-summary';

/**
 * Built from the real summaries in production on 18 October 2026, where 746 of
 * 749 rows read "Sleep: 0.0 hours" beside real steps and heart rate -- and the
 * portrait turned that into "logging repeated zero-sleep nights".
 */

const REAL_DAY = 'Apple Health summary for May 18, 2026:\n\nSteps: 6557\nActive Energy: 412 kcal\nAverage Heart Rate: 71 BPM\nSleep: 0.0 hours\nMindfulness: 0 minutes';

test('a zero sleep reading becomes "not recorded", not a night without sleep', () => {
  const out = normalizeHealthSummary(REAL_DAY);
  assert.match(out, /Sleep: not recorded/);
  assert.doesNotMatch(out, /Sleep: 0/, 'the model must never see zero sleep as a measurement');
});

test('real readings beside it are left exactly as they were', () => {
  // The fix must not touch what was genuinely measured.
  const out = normalizeHealthSummary(REAL_DAY);
  assert.match(out, /Steps: 6557/);
  assert.match(out, /Active Energy: 412 kcal/);
  assert.match(out, /Average Heart Rate: 71 BPM/);
});

test('a heart rate of zero is "not recorded" — it cannot be a reading', () => {
  assert.match(normalizeHealthSummary('Average Heart Rate: 0 BPM'), /Average Heart Rate: not recorded/);
});

test('a day where nothing was measured reads as nothing measured', () => {
  // Three production rows had every field at zero.
  const empty = 'Steps: 0\nActive Energy: 0 kcal\nAverage Heart Rate: 0 BPM\nSleep: 0.0 hours\nMindfulness: 0 minutes';
  const out = normalizeHealthSummary(empty);
  assert.equal((out.match(/not recorded/g) ?? []).length, 5);
  assert.doesNotMatch(out, /: 0/);
});

test('small real values are not mistaken for zero', () => {
  // Guard against an over-eager match: 0.5 hours and 10 steps are real.
  assert.match(normalizeHealthSummary('Sleep: 0.5 hours'), /Sleep: 0\.5 hours/);
  assert.match(normalizeHealthSummary('Steps: 10'), /Steps: 10/);
  assert.match(normalizeHealthSummary('Steps: 100'), /Steps: 100/);
});

test('the header line with a date is left alone', () => {
  const out = normalizeHealthSummary(REAL_DAY);
  assert.match(out, /^Apple Health summary for May 18, 2026:/);
});

test('only health summaries are normalised', () => {
  // A journal saying "I slept 0 hours" is the person's own words, and is theirs
  // to mean. This rule is about sensors, not people.
  assert.equal(isHealthSummary('healthkit'), true);
  assert.equal(isHealthSummary('journal_entry'), false);
});

test('only recorded readings are shown: absence is removed, not labelled', () => {
  const out = recordedReadingsOnly('Apple Health summary for Aug 8, 2026:\n\nSteps: 8660\nSleep: 0.0 hours\nMindfulness: 0 minutes\nAverage Heart Rate: Unavailable BPM\nSleep stages: ');
  assert.equal(out, 'Apple Health summary for Aug 8, 2026:\n\nSteps: 8660');
});
