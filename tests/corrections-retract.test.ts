/** Gate F-C (goal 20): rejecting a claim retires exactly what rested only on it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planRetraction, type Edge } from '../src/corrections/retract';

const gate = JSON.parse(readFileSync('tests/fixtures/gates/f-c-retraction.json', 'utf8')) as {
  cases: Array<{ id: string; target: string; inactive?: string[]; edges: Edge[]; expect: { retire: string[]; survive: string[] } }>;
};

for (const c of gate.cases) {
  test(`${c.id}`, () => {
    const [kind, id] = c.target.split(':') as [Edge['claim']['kind'], string];
    const plan = planRetraction({ kind, id }, c.edges, new Set(c.inactive ?? []));
    assert.deepEqual(plan.retire.map((r) => `${r.kind}:${r.id}`).sort(), [...c.expect.retire].sort());
    assert.deepEqual(plan.weaken.map((w) => `${w.claim.kind}:${w.claim.id}`).sort(), [...c.expect.survive].sort());
    assert.equal(plan.retire[0]!.because, 'rejected');
  });
}
