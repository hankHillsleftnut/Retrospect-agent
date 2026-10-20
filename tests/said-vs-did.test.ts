/** W4.3: each goal beside what was done; two numbers, never one score. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vetLinks, assembleSaidVsDid, readSaidVsDid, type Candidate, type GoalInput } from '../src/understanding/said-vs-did';

const goals: GoalInput[] = [
  { id: 'raise', title: 'Raise a seed round', description: null, created_at: '2026-06-01T00:00:00Z', last_mentioned_at: '2026-10-10T00:00:00Z' },
  { id: 'piano', title: 'Learn piano', description: null, created_at: '2026-06-01T00:00:00Z', last_mentioned_at: null },
];
const items: Candidate[] = [
  { id: 'e1', kind: 'event', text: 'Investor call', hours: 1, recent: true },
  { id: 'e2', kind: 'event', text: 'Pitch practice', hours: 2, recent: false },
  { id: 'e3', kind: 'event', text: 'Dentist', hours: 1, recent: true },
  { id: 'c1', kind: 'content', text: 'How seed rounds work' },
  { id: 'p1', kind: 'pattern', text: 'skips standup' },
];

test('only links between real goals and real items survive, once each', () => {
  const l = vetLinks(goals, items, { links: [{ goal: 0, items: [0, 1, 1, 3, 99] }, { goal: 7, items: [2] }, { goal: 1, items: 'none' }] });
  assert.deepEqual(l.get('raise')!.map((c) => c.id), ['e1', 'e2', 'c1']);
  assert.deepEqual(l.get('piano'), []);
});

test('said and did sit side by side; a goal with nothing done still shows, with zeros', () => {
  const l = vetLinks(goals, items, { links: [{ goal: 0, items: [0, 1, 3] }] });
  const [raise, piano] = assembleSaidVsDid(goals, l, 4);
  assert.deepEqual(raise!.did, { hoursThisWeek: 1, hoursUsualWeek: 0.5, events: 2, contentItems: 1, patterns: [] });
  assert.deepEqual(raise!.said, { statedAt: '2026-06-01T00:00:00Z', lastMentionedAt: '2026-10-10T00:00:00Z' });
  assert.deepEqual(piano!.did, { hoursThisWeek: 0, hoursUsualWeek: 0, events: 0, contentItems: 0, patterns: [] });
  assert.ok(!('score' in raise!) && !('gap' in raise!), 'never merged into one number');
  assert.deepEqual(raise!.evidence, ['e1', 'e2', 'c1']);
});

test('no active goals: no model call', async () => {
  const fakeDb = { from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) }) } as never;
  let called = false;
  const r = await readSaidVsDid('u', fakeDb, new Date(), async () => { called = true; return { data: {}, usage: { inputTokens: 0, outputTokens: 0 } }; });
  assert.deepEqual(r.goals, []);
  assert.equal(called, false);
});
