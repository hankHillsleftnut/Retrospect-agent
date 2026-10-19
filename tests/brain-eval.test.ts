import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreOne, scoreByAbility, type EvalQuestion } from '../src/eval/brain-eval';

const q = (x: Partial<EvalQuestion>): EvalQuestion => ({ id: 'q', ability: 'extraction', question: '?', ...x });
const a = (answer: string, abstain = false, cites: string[] = []) => ({ id: 'q', abstain, answer, cites });

test('an answer must contain every required part; a|b accepts either', () => {
  const t = q({ answer: 'x', must_include: ['walnut', '180|one hundred eighty'] });
  assert.equal(scoreOne(t, a('A walnut box for $180'), new Set()).correct, true);
  assert.equal(scoreOne(t, a('A box for $180'), new Set()).why, 'missing walnut');
});

test('abstaining is right only where the answer is unknowable', () => {
  assert.equal(scoreOne(q({ ability: 'abstention', abstain: true }), a("Can't say", true), new Set()).correct, true);
  assert.equal(scoreOne(q({ ability: 'abstention', abstain: true }), a('Yes'), new Set()).correct, false);
  assert.equal(scoreOne(q({ answer: 'x', must_include: ['x'] }), a('', true), new Set()).correct, false);
});

test('answering on an automated guess fails; noticing it and declining is right', () => {
  const t = q({ ability: 'abstention', abstain: true, must_not_cite: ['m26'] });
  assert.match(scoreOne(t, a('Yes, she is burned out'), new Set(['m26'])).why, /automated guess/);
  assert.equal(scoreOne(t, a('Only a newsletter says so; not evidence', true), new Set(['m26'])).correct, true);
});

test('saying the forbidden thing fails', () => {
  assert.equal(scoreOne(q({ answer: 'x', must_include: ['dropped'], must_not_say: ['is training'] }), a('She dropped it but is training'), new Set()).correct, false);
});

test('scores roll up by ability', () => {
  const s = scoreByAbility([
    { id: '1', ability: 'temporal', correct: true, why: '' },
    { id: '2', ability: 'temporal', correct: false, why: '' },
  ]);
  assert.deepEqual(s.find((x) => x.ability === 'temporal'), { ability: 'temporal', correct: 1, total: 2, rate: 0.5 });
});
