/** W4.4: what they paid attention to, grouped by topic; never a feeling. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentGroups, vetName, nameGroups, type ContentItem } from '../src/understanding/content-groups';

// Three topics on separate axes, each item nudged a little; deterministic.
const axis = (k: number, jitter: number) => Array.from({ length: 12 }, (_, d) => (d === k ? 1 : 0) + ((d * 7 + jitter * 13) % 5) * 0.02);
const item = (id: string, topic: number, j: number): ContentItem => ({ id, title: `${id}`, kind: 'liked_video', vector: axis(topic, j) });

test('items group by topic; a pair is too small to be a group', () => {
  const items = [item('w1', 0, 1), item('w2', 0, 2), item('w3', 0, 3), item('w4', 0, 4), item('f1', 3, 1), item('f2', 3, 2), item('f3', 3, 3), item('j1', 7, 1), item('j2', 7, 2)];
  const r = contentGroups(items, []);
  assert.deepEqual(r.groups.map((g) => g.itemIds), [['w1', 'w2', 'w3', 'w4'], ['f1', 'f2', 'f3']]);
  assert.equal(r.scattered, 2);
});

test('a group is tied to a goal only when they are about the same thing', () => {
  const items = [item('f1', 3, 1), item('f2', 3, 2), item('f3', 3, 3)];
  const r = contentGroups(items, [{ id: 'raise', vector: axis(3, 9) }, { id: 'marathon', vector: axis(10, 9) }]);
  assert.deepEqual(r.groups[0]!.goalIds, ['raise']);
});

test('names describe content, never a feeling, and stay short', () => {
  assert.equal(vetName('Startup Fundraising'), 'startup fundraising');
  assert.equal(vetName('coping with burnout'), null);
  assert.equal(vetName('feeling anxious lately'), null);
  assert.equal(vetName('a very long name for a group'), null);
});

test('naming keeps only vetted names for groups that exist', async () => {
  const groups = [{ itemIds: ['a'], titles: ['x'], goalIds: [], label: null }, { itemIds: ['b'], titles: ['y'], goalIds: [], label: null }];
  const { groups: named } = await nameGroups(groups, async () => ({ data: { names: [{ g: 0, name: 'Woodworking' }, { g: 1, name: 'escaping stress' }, { g: 5, name: 'ghost' }] }, usage: { inputTokens: 1, outputTokens: 1 } }));
  assert.deepEqual(named.map((g) => g.label), ['woodworking', null]);
});
