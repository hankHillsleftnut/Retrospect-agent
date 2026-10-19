import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStatedGoals, MAX_STATED_GOALS, type StatedGoalsModel } from '../src/onboarding/stated-goals';

const ANSWERS = `Q: What are you hoping changes in your life right now?
A: I want to raise money for Retrospect and move to New York by spring.

Q: What feels like the biggest thing standing in your way?
A: Honestly I go quiet when I feel inadequate and stop reaching out to people.`;

const usage = { inputTokens: 100, outputTokens: 50 };
const replying = (goals: unknown[]): StatedGoalsModel => async () => ({ data: { goals }, usage });

test('a goal quoting the answers is kept', async () => {
  const r = await extractStatedGoals(ANSWERS, replying([
    { title: 'Raise for Retrospect', description: 'Fund the company.', reasoning: '', quote: 'raise money for Retrospect and move to New York' },
  ]));
  assert.equal(r.goals.length, 1);
  assert.equal(r.goals[0]!.title, 'Raise for Retrospect');
  assert.equal(r.dropped, 0);
});

test('a goal whose quote is not in the answers is dropped, and counted', async () => {
  const r = await extractStatedGoals(ANSWERS, replying([
    { title: 'Run a marathon', description: 'x', reasoning: '', quote: 'I want to run a marathon this year' },
    { title: 'Stay in touch', description: 'x', reasoning: '', quote: 'stop reaching out to people' },
  ]));
  assert.deepEqual(r.goals.map((g) => g.title), ['Stay in touch']);
  assert.equal(r.dropped, 1);
});

test('no more than the cap, however many come back', async () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ title: `Goal ${i}`, description: '', reasoning: '', quote: 'raise money for Retrospect' }));
  const r = await extractStatedGoals(ANSWERS, replying(many));
  assert.equal(r.goals.length, MAX_STATED_GOALS);
});

test('em dashes never reach the person', async () => {
  const r = await extractStatedGoals(ANSWERS, replying([
    { title: 'Move — New York', description: 'Big city — big step.', reasoning: '', quote: 'move to New York by spring' },
  ]));
  assert.equal(r.goals[0]!.title.includes('—'), false);
  assert.equal(r.goals[0]!.description.includes('—'), false);
});

test('empty answers make no model call', async () => {
  let called = false;
  const r = await extractStatedGoals('   ', async () => { called = true; return { data: {}, usage }; });
  assert.equal(called, false);
  assert.deepEqual(r.goals, []);
});

test('a malformed reply yields no goals rather than an error', async () => {
  const r = await extractStatedGoals(ANSWERS, async () => ({ data: { goals: 'nope' }, usage }));
  assert.deepEqual(r.goals, []);
});
