import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributedFromOthers, covers, scoreRecall, totals, type Candidate } from '../src/eval/bank-score';

const TEXT = 'I have about 50k before I need to get another job. And I hope that I never get to the bottom of that savings amount lmao.';
const c = (excerpt: string, subject = 'Self'): Candidate => ({ subject, predicate: 'said_about_self', object: 'x', excerpt });

test('the same fact quoted a little longer or shorter still counts', () => {
  const r = scoreRecall(TEXT, [{ claim: 'has $50k saved', excerpt: 'I have about 50k before I need to get another job.' }],
    [c('about 50k before I need to get another job')]);
  assert.deepEqual(r.found, ['has $50k saved']);
});

test('a different fact from the same entry does not count', () => {
  const r = scoreRecall(TEXT, [{ claim: 'has $50k saved', excerpt: 'I have about 50k before I need to get another job.' }],
    [c('I hope that I never get to the bottom of that savings amount')]);
  assert.deepEqual(r.missed, ['has $50k saved']);
});

test('a candidate whose quote is invented counts as unverifiable, and finds nothing', () => {
  const r = scoreRecall(TEXT, [{ claim: 'has $50k saved', excerpt: 'I have about 50k before I need to get another job.' }],
    [c('I have roughly fifty thousand saved')]);
  assert.equal(r.unverifiable, 1);
  assert.deepEqual(r.found, []);
});

test('overlap must be at least half of the shorter quote', () => {
  assert.equal(covers([0, 10], [5, 30]), true);
  assert.equal(covers([0, 10], [8, 30]), false);
});

test("any claim about the user from someone else's words is a false positive", () => {
  const wrong = attributedFromOthers('other (Farza)', [c('My name is Farza.'), c('Clicky', 'Farza')]);
  assert.equal(wrong.length, 1);
  assert.deepEqual(attributedFromOthers('self', [c('anything')]), []);
});

test('totals add up across entries', () => {
  const t = totals([
    { entry: 'a', cases: [], expected: 4, found: ['1', '2', '3'], missed: ['4'], candidates: 5, unverifiable: 1, falsePositives: [] },
    { entry: 'b', cases: [], expected: 0, found: [], missed: [], candidates: 2, unverifiable: 0, falsePositives: [{ candidate: c('x'), matches: 'y' }] },
  ]);
  assert.deepEqual(t, { entries: 2, expected: 4, found: 3, recall: 0.75, candidates: 7, unverifiable: 1, falsePositives: 1 });
});
