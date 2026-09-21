import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRelation, isRefinement, sameTopic } from '../src/brain/supersession';

// ── Example B from the locked spec ───────────────────────────────────────────

test('Example B: quitting retires the goal', () => {
  const jan = { predicate: 'stated_goal', object: 'half_marathon' };
  const mar = { predicate: 'quit_or_stopped', object: 'half_marathon' };
  assert.equal(classifyRelation(jan, mar), 'supersedes');
});

test('Example B, the negative half: a training run does NOT retire the goal', () => {
  const jan = { predicate: 'stated_goal', object: 'half_marathon' };
  const feb = { predicate: 'attended', object: 'three_mile_run' };
  assert.equal(classifyRelation(jan, feb), 'unrelated',
    'over-eager supersession erases history as surely as under-eager keeps lies');
});

test('restating the same goal is a duplicate, not a new fact', () => {
  const a = { predicate: 'stated_goal', object: 'half_marathon' };
  assert.equal(classifyRelation(a, { ...a }), 'duplicate');
});

// ── The line that keeps patterns countable ───────────────────────────────────

test('two Thursday skips do NOT retire each other', () => {
  const wk1 = { predicate: 'skipped_or_avoided', object: 'thursday_standup', eventTime: '2026-02-12' };
  const wk3 = { predicate: 'skipped_or_avoided', object: 'couldnt_face_standup', eventTime: '2026-02-26' };
  assert.equal(classifyRelation(wk1, wk3), 'unrelated');
});

test('three skips survive as three facts, or the promoter has nothing to count', () => {
  const skips = ['2026-02-12', '2026-02-19', '2026-02-26'].map((d) => ({
    predicate: 'skipped_or_avoided', object: 'thursday_standup', eventTime: d,
  }));
  for (let i = 0; i < skips.length; i++) {
    for (let j = 0; j < skips.length; j++) {
      if (i === j) continue;
      const rel = classifyRelation(skips[i]!, skips[j]!);
      assert.notEqual(rel, 'supersedes', 'episodic facts must never retire each other');
    }
  }
});

test('attending after skipping is not a contradiction', () => {
  const skipped = { predicate: 'skipped_or_avoided', object: 'standup' };
  const went = { predicate: 'attended', object: 'standup' };
  assert.equal(classifyRelation(skipped, went), 'unrelated');
});

test('self-talk never supersedes earlier self-talk', () => {
  const a = { predicate: 'said_about_self', object: 'im_terrible_at_this' };
  const b = { predicate: 'said_about_self', object: 'im_getting_better' };
  assert.equal(classifyRelation(a, b), 'unrelated');
});

// ── Stateful facts ───────────────────────────────────────────────────────────

test('a changed goal on the same topic supersedes', () => {
  const a = { predicate: 'stated_goal', object: 'half_marathon' };
  const b = { predicate: 'stated_goal', object: 'half_marathon_sub_two' };
  assert.equal(classifyRelation(a, b), 'supersedes');
  assert.equal(isRefinement(a, b), true);
});

test('an unrelated goal is a second goal, not a replacement', () => {
  const a = { predicate: 'stated_goal', object: 'half_marathon' };
  const b = { predicate: 'stated_goal', object: 'learn_spanish' };
  assert.equal(classifyRelation(a, b), 'unrelated');
});

test('a quit about a different thing retires nothing', () => {
  const goal = { predicate: 'stated_goal', object: 'half_marathon' };
  const quit = { predicate: 'quit_or_stopped', object: 'spanish_lessons' };
  assert.equal(classifyRelation(goal, quit), 'unrelated');
});

// ── Topic matching is deliberately conservative ──────────────────────────────

test('topic match requires whole tokens, not arbitrary substrings', () => {
  assert.equal(sameTopic('half_marathon', 'half_marathon'), true);
  assert.equal(sameTopic('half_marathon', 'marathon'), true);
  assert.equal(sameTopic('marathon', 'half_marathon_training'), true);
  assert.equal(sameTopic('art', 'artichokes'), false, 'short substrings must not match');
  assert.equal(sameTopic('spanish', 'half_marathon'), false);
});

test('an unknown predicate refuses to guess', () => {
  const a = { predicate: 'invented_by_the_model', object: 'x' };
  const b = { predicate: 'invented_by_the_model', object: 'y' };
  assert.equal(classifyRelation(a, b), 'unrelated',
    'a stale fact beats erased history');
});

// --- review fix: a fact must not retire something newer than itself ---

test('the backfill hazard: an older fact must not retire the current truth', () => {
  // Reprocessing 2,034 historical rows feeds facts in arbitrary order. The
  // classifier alone says "supersedes" in BOTH directions here, because it
  // only compares shape. Time ordering is what stops a January statement
  // replacing the March one.
  const january = { predicate: 'stated_goal', object: 'half_marathon', eventTime: '2026-01-08' };
  const march = { predicate: 'stated_goal', object: 'half_marathon_sub_two', eventTime: '2026-03-05' };

  assert.equal(classifyRelation(january, march), 'supersedes', 'newer over older: correct');
  assert.equal(classifyRelation(march, january), 'supersedes',
    'the classifier is time-blind by design; the write path must apply the ordering');
});

test('supersession direction is a property of time, not of shape', () => {
  const a = { predicate: 'stated_goal', object: 'half_marathon', eventTime: '2026-01-08' };
  const b = { predicate: 'stated_goal', object: 'half_marathon', eventTime: '2026-03-05' };
  // Identical objects are a duplicate regardless of order -- no retirement.
  assert.equal(classifyRelation(a, b), 'duplicate');
  assert.equal(classifyRelation(b, a), 'duplicate');
});
