/** Gate F-S1 (goal 22): appetite starts safe, rises slowly on evidence, drops fast, and the person's word wins. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { effective, inferLevel, readAppetite, refreshAppetite, setStatedAppetite, type Signal } from '../src/appetite/appetite';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

const now = new Date('2026-10-20T12:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * 864e5).toISOString();
const sig = (kind: Signal['kind'], days: number): Signal => ({ kind, at: ago(days), what: kind });

const cases: Array<[string, 0 | 1 | 2 | 3, Signal[], number]> = [
  ['a new person with nothing to go on starts at 0', 0, [], 0],
  ['two engagements in 14 days raise one step', 0, [sig('engaged', 2), sig('engaged', 9)], 1],
  ['one engagement is not enough', 0, [sig('engaged', 1)], 0],
  ['engagement older than 14 days does not count', 1, [sig('engaged', 20), sig('engaged', 25)], 1],
  ['any discomfort in the last 7 days drops a step', 2, [sig('engaged', 1), sig('engaged', 2), sig('discomfort', 3)], 1],
  ['discomfort can never go below 0', 0, [sig('discomfort', 1)], 0],
  ['discomfort 8 to 14 days ago blocks a rise without dropping', 1, [sig('engaged', 1), sig('engaged', 2), sig('discomfort', 10)], 1],
  ['3 is the ceiling', 3, [sig('engaged', 1), sig('engaged', 2)], 3],
];
for (const [name, prev, signals, want] of cases) {
  test(name, () => assert.equal(inferLevel(prev, signals, now).level, want));
}

test('the person\'s own setting always outranks the inferred one', () => {
  assert.deepEqual(effective({ stated: 2, inferred: 0 }).level, 2);
  assert.equal(effective({ stated: 2, inferred: 0 }).source, 'stated');
  assert.equal(effective({ stated: null, inferred: 1, reasons: ['x'] }).level, 1);
  assert.equal(effective(undefined).level, 0);
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('the same signals raise it once, not once per day', async () => {
  const user = await insertUser(db);
  const self = (await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'x') RETURNING id`, [user])).rows[0]!.id;
  for (const [q, d] of [[30, 2], [31, 3]] as const) {
    const a = (await db.query<{ id: string }>(`SELECT record_answer($1::jsonb) AS id`, [JSON.stringify({ user_id: user, question_id: q, answer: 'a', derived_by: 'first_pass', derivation_key: `d${q}`, evidence: [{ raw_content_id: self, excerpt: 'x' }] })])).rows[0]!.id;
    await db.query(`UPDATE question_answers SET user_verdict = 'confirmed', verdict_at = $2 WHERE id = $1`, [a, ago(d)]);
  }
  assert.equal((await refreshAppetite(user, { now })).level, 1);
  assert.equal((await refreshAppetite(user, { now: new Date(now.getTime() + 864e5) })).level, 1, 'the next day, the same two signals do not raise it again');
});

test('setting it is remembered, outranks inference, and clearing it hands back', async () => {
  const user = await insertUser(db);
  assert.equal((await readAppetite(user)).level, 0);
  assert.deepEqual(await setStatedAppetite(user, 2), { level: 2, source: 'stated', reasons: ['you chose this'] });
  await refreshAppetite(user, { now });
  assert.equal((await readAppetite(user)).level, 2);
  assert.equal((await setStatedAppetite(user, null)).source, 'inferred');
});

test('at appetite 0 the episode asks nothing; with the switch off it behaves as before', async () => {
  const { planEpisode } = await import('../src/planner/plan');
  const contract = {
    userId: 'u', asOf: '2026-10-20', answers: [], silent: [], goals: [], shifts: [], time: { categories: [], otherShare: 0, weeksOfBaseline: 0 }, moves: { since: null, items: [] },
    patterns: [{ kind: 'pattern', id: 'p1', label: 'Says yes', confidence: 0.8, instances: 5, firstSeenAt: null, lastSeenAt: null, trajectory: null, trajectoryDetail: null, register: 'stated' }],
    whys: [{ kind: 'why', id: 'w1', patternId: 'p1', mechanism: 'avoidance', confidence: 0.6, register: 'asked' }],
  } as unknown as Parameters<typeof planEpisode>[0];
  assert.equal(planEpisode(contract, {}, 6, 0).reflection, null);
  assert.equal(planEpisode(contract, {}, 6, 1).reflection?.whyId, 'w1');
  assert.equal(planEpisode(contract, {}, 6, undefined).reflection?.whyId, 'w1');
});
