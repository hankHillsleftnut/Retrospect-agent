/** Gate W5 (cases declared before code, #54): >= 80%; never pads. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectItems, type PlanCandidate } from '../src/planner/select';

const gate = JSON.parse(readFileSync('tests/fixtures/gates/w5-selection.json', 'utf8')) as {
  cases: Array<{ id: string; candidates: Array<{ id: string; bears_on: string; strength: number; moved: boolean; duplicates?: string }>; max_items?: number; expect_selected: string[]; expect_excluded_reasons?: Record<string, string> }>;
};

test('gate W5: every case selects exactly what was declared, and says why it left things out', () => {
  for (const c of gate.cases) {
    const plan = selectItems(c.candidates.map((x): PlanCandidate => ({ id: x.id, topic: x.bears_on, strength: x.strength, moved: x.moved, duplicateOf: x.duplicates })), c.max_items ?? 6);
    assert.deepEqual([...plan.selected].sort(), [...c.expect_selected].sort(), c.id);
    for (const [id, why] of Object.entries(c.expect_excluded_reasons ?? {})) assert.equal(plan.excluded[id], why, `${c.id}/${id}`);
  }
});

test('a quiet week selects nothing rather than padding', () => {
  assert.deepEqual(selectItems([{ id: 'a', topic: 'x', strength: 0.2 }]).selected, []);
});

test('the spine is the most worth saying; a goal tie lifts an item', () => {
  const plan = selectItems([{ id: 'a', topic: 'x', strength: 0.6 }, { id: 'b', topic: 'y', strength: 0.55, goalLinked: true }]);
  assert.equal(plan.spine, 'b');
});

test('D1: something said recently loses to a fresh item of equal strength, unless it moved', () => {
  const fresh = { id: 'fresh', topic: 'a', strength: 0.6 };
  const repeat = { id: 'repeat', topic: 'b', strength: 0.6, saidRecently: true };
  assert.equal(selectItems([repeat, fresh], 1).selected[0], 'fresh');
  assert.equal(selectItems([{ ...repeat, moved: true }, fresh], 1).selected[0], 'repeat', 'a repeated item that changed is news again');
  assert.deepEqual(selectItems([{ id: 'r', topic: 'c', strength: 0.5, saidRecently: true }]).selected, [], 'a weak repeat drops under the bar');
});
