/** Gate F-S2 (goal 9): stock comfort and performed empathy are cut; specific, warm lines stay. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { styleIssue } from '../src/writer/style';

const gate = JSON.parse(readFileSync('tests/fixtures/gates/f-s-style.json', 'utf8')) as { cases: Array<{ id: string; text: string; expect: 'cut' | 'kept' }> };
for (const c of gate.cases) {
  test(`${c.id} ${c.expect}: ${c.text}`, () => assert.equal(styleIssue(c.text) ? 'cut' : 'kept', c.expect));
}
