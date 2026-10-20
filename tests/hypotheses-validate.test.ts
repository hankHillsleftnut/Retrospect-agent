/** Gate F-H (goal 21): nothing clinical gets through; every invalid proposal is rejected. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { invalid, FRAMEWORKS } from '../src/hypotheses/validate';

const gate = JSON.parse(readFileSync('tests/fixtures/gates/f-h-validation.json', 'utf8')) as {
  cases: Array<{ id: string; framework: string; question: string; supports: number; sources: number; domainMaySpeak: boolean; expect: string }>;
};
for (const c of gate.cases) {
  test(`${c.id}: ${c.expect}`, () => {
    const r = invalid(c);
    assert.equal(r ? `rejected: ${r}` : 'valid', c.expect, c.question);
  });
}

test('every framework names itself and its source on request', () => {
  for (const f of Object.values(FRAMEWORKS)) assert.ok(f.name && f.cite && f.wonders);
});
