/** F2.1: the brain evaluation set is well-formed and agrees with its own data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { trustForRow } from '../src/brain/trust';

const DIR = 'tests/fixtures/eval';
const ABILITIES = ['extraction', 'multi_session', 'update', 'temporal', 'abstention'];

interface Item { id: string; date: string; content_type: string; trust: string; content: string; metadata?: Record<string, unknown> }
interface Question {
  id: string; ability: string; question: string; answer?: string; abstain?: boolean; reason?: string;
  must_include?: string[]; support?: string[]; must_not_cite?: string[];
  count?: { of: string; content_type?: string; equals: number };
}
const sets = readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { persona: string; as_of: string; items: Item[]; questions: Question[] });

test('there is at least one persona, with 40+ questions across all five abilities', () => {
  assert.ok(sets.length > 0);
  const all = sets.flatMap((s) => s.questions);
  assert.ok(all.length >= 40, `${all.length} questions`);
  for (const a of ABILITIES) assert.ok(all.filter((q) => q.ability === a).length >= 5, `${a} has fewer than 5`);
});

for (const set of sets) {
  const items = new Map(set.items.map((i) => [i.id, i]));

  test(`${set.persona}: ids are unique and items fall on or before as_of`, () => {
    assert.equal(items.size, set.items.length);
    assert.equal(new Set(set.questions.map((q) => q.id)).size, set.questions.length);
    for (const i of set.items) assert.ok(i.date <= set.as_of, i.id);
  });

  test(`${set.persona}: every question has an answer with support, or abstains with a reason`, () => {
    for (const q of set.questions) {
      assert.ok(ABILITIES.includes(q.ability), `${q.id}: ${q.ability}`);
      if (q.abstain) {
        assert.equal(q.ability, 'abstention', q.id);
        assert.ok(q.reason && !q.answer && !q.support, q.id);
      } else {
        assert.ok(q.answer && q.support?.length, q.id);
        for (const id of q.support!) assert.ok(items.has(id), `${q.id} cites missing ${id}`);
      }
      for (const id of q.must_not_cite ?? []) assert.ok(items.has(id), `${q.id}: ${id}`);
    }
  });

  test(`${set.persona}: answers rest only on what can be evidence about the person`, () => {
    for (const q of set.questions) for (const id of q.support ?? []) {
      assert.notEqual(items.get(id)!.trust, 'automated', `${q.id} rests on automated ${id}`);
    }
  });

  test(`${set.persona}: each item's declared trust matches the classifier`, () => {
    for (const i of set.items) {
      assert.equal(trustForRow({ content_type: i.content_type, content: i.content, metadata: i.metadata ?? {} } as never), i.trust, i.id);
    }
  });

  test(`${set.persona}: counted answers match the data`, () => {
    for (const q of set.questions.filter((x) => x.count)) {
      const n = set.items.filter((i) => i.content.includes(q.count!.of) && (!q.count!.content_type || i.content_type === q.count!.content_type)).length;
      assert.equal(n, q.count!.equals, q.id);
    }
  });
}
