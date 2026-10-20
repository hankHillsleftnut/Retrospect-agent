/** W6.1: the decision rules of the claim guard (the model's judgement is faked here; eval:guard runs the real gate). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, guardSentences } from '../src/writer/claim-guard';

test('craft with no claims about the person passes', () => {
  assert.equal(decide({ text: 'Let\'s start with the gym.', evidence: [] }, { claims: [], isQuestion: false }).verdict, 'supported');
});

test('a stated sentence fails on any unsupported claim, and says which', () => {
  const r = decide({ text: 'You skipped the gym and feel ashamed.', evidence: ['Skipped the gym again.'] },
    { claims: [{ claim: 'skipped the gym', supported: true }, { claim: 'feels ashamed', supported: false }], isQuestion: false });
  assert.deepEqual([r.verdict, r.reason], ['unsupported', 'not in the evidence: feels ashamed']);
});

test('an asked sentence must read as a question, on supported ground', () => {
  const asked = { text: 'I wonder whether it is the mornings.', register: 'asked' as const, evidence: ['Morning workouts never stick.'] };
  assert.equal(decide(asked, { claims: [], isQuestion: true }).verdict, 'supported');
  assert.equal(decide(asked, { claims: [], isQuestion: false }).reason, 'meant to be asked, but reads as a statement');
  assert.equal(decide(asked, { claims: [{ claim: 'skips mornings daily', supported: false }], isQuestion: true }).verdict, 'unsupported');
});

test('a sentence the model skipped is unsupported, never waved through', async () => {
  const { results } = await guardSentences([{ text: 'a', evidence: [] }, { text: 'b', evidence: [] }],
    async () => ({ data: { sentences: [{ i: 0, claims: [], isQuestion: false }] }, usage: { inputTokens: 1, outputTokens: 1 } }));
  assert.deepEqual(results.map((r) => r.verdict), ['supported', 'unsupported']);
});
