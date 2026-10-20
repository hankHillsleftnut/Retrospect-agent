/** F-C3: plain-language corrections apply only when the target is unambiguous. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCorrection, type Candidate } from '../src/corrections/target';

const u = { inputTokens: 1, outputTokens: 1 };
const cands: Candidate[] = [{ n: 1, kind: 'answer', id: 'a1', text: 'You want to go part-time.' }, { n: 2, kind: 'fact', id: 'f1', text: 'values: family' }];

test('praise is not a correction', async () => {
  const r = await handleCorrection('u', 'Loved it', { candidates: cands, model: async () => ({ data: { correction: false }, usage: u }) });
  assert.equal(r.outcome, 'not_a_correction');
});

test('unsure: ask, with the proposed claim first', async () => {
  const r = await handleCorrection('u', 'not true', { candidates: cands, model: async () => ({ data: { correction: true, target: 2, sure: false }, usage: u }) });
  assert.equal(r.outcome, 'confirm');
  assert.equal(r.outcome === 'confirm' && r.candidates[0]!.id, 'f1');
});

test('a reply that fails twice asks, never guesses', async () => {
  let calls = 0;
  const r = await handleCorrection('u', 'wrong', { candidates: cands, model: async () => { calls++; throw new Error('No JSON object found'); } });
  assert.equal(r.outcome, 'confirm');
  assert.equal(calls, 2);
});

test('a target number that is not among the candidates asks', async () => {
  const r = await handleCorrection('u', 'wrong', { candidates: cands, model: async () => ({ data: { correction: true, target: 9, sure: true }, usage: u }) });
  assert.equal(r.outcome, 'confirm');
});
