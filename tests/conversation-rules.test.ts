/** Gate F-V (goal 18): the deterministic rules for a conversation reply. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restatesAsDiscovery, sentenceBudget, mayReveal } from '../src/conversation/rules';

const today = ['I skipped my run again because I stayed up late on Friday', 'work has been crazy with the Q4 launch'];

test('restating their own words as an observation is caught', () => {
  for (const s of [
    'It sounds like you skipped your run because you stayed up late on Friday.',
    'I notice work has been crazy with the Q4 launch.',
    'It seems you skipped the run again after staying up late.',
  ]) assert.equal(restatesAsDiscovery(s, today), true, s);
});

test('genuine answers, new information and plain echoes are not', () => {
  for (const s of [
    'That is the third Saturday this month the run went after a late Friday.',
    'Want me to move Saturday runs to Sunday mornings?',
    'You skipped your run because you stayed up late.',
    'It seems the Q4 launch lands in two weeks, by Dana\'s email.',
    'Got it.',
  ]) assert.equal(restatesAsDiscovery(s, today), false, s);
});

test('the reply length stays bounded: short message, short reply; never more than 4 sentences', () => {
  assert.equal(sentenceBudget('ok'), 1);
  assert.equal(sentenceBudget('how did the run go this week compared to last?'), 1);
  assert.equal(sentenceBudget('word '.repeat(30)), 3);
  assert.equal(sentenceBudget('word '.repeat(45)), 4);
  assert.equal(sentenceBudget('word '.repeat(500)), 4);
});

test('context rules: unasked, nothing silent, flagged, extreme or saved; never automated or third-party mail as fact', () => {
  assert.equal(mayReveal({ kind: 'answer', id: 'a', silentDomain: true }, false), false);
  assert.equal(mayReveal({ kind: 'answer', id: 'a', silentDomain: true }, true), true);
  assert.equal(mayReveal({ kind: 'pattern', id: 'p', severity: 'extreme' }, false), false);
  assert.equal(mayReveal({ kind: 'saved', id: 's' }, false), false);
  assert.equal(mayReveal({ kind: 'saved', id: 's' }, true), true);
  assert.equal(mayReveal({ kind: 'pattern', id: 'p', flagged: true }, true), false, 'flagged stays out even when asked');
  assert.equal(mayReveal({ kind: 'item', id: 'i', trust: 'automated' }, true), false);
  assert.equal(mayReveal({ kind: 'item', id: 'i', trust: 'third_party' }, true), false);
  assert.equal(mayReveal({ kind: 'pattern', id: 'p' }, false), true);
});
