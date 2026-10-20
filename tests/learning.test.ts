/** Gate F-Q (goal 19): it learns about its own questions, within bounds, and never writes a claim about the person. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { armStats, weightFor, refreshLearning, readLearning, WEIGHT_MIN, WEIGHT_MAX, type Asked } from '../src/learning/reception';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

const asked = (arm: string, n: number): Asked[] => Array.from({ length: n }, (_, i) => ({ arm, id: `${arm}#${i}`, at: '2026-10-01' }));

test('with no history every weight is 1.0', () => {
  assert.deepEqual(armStats([], new Set()), []);
  assert.equal(weightFor(undefined, 'why'), 1);
  assert.equal(weightFor([], 'answer:want'), 1);
});

test('weights stay within 0.8-1.2 whatever the history', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let trial = 0; trial < 200; trial++) {
    const a = ['why', 'hypothesis:flow', 'answer:want', 'answer:how'].flatMap((arm) => asked(arm, Math.floor(rand() * 30)));
    const answered = new Set(a.filter(() => rand() < rand()).map((x) => x.id));
    for (const s of armStats(a, answered)) assert.ok(s.weight >= WEIGHT_MIN && s.weight <= WEIGHT_MAX, `${s.arm} ${s.weight}`);
  }
});

test('a kind of question that gets answered more is weighted up, one that is ignored down', () => {
  const a = [...asked('why', 10), ...asked('answer:want', 10)];
  const answered = new Set([...asked('answer:want', 10).slice(0, 8).map((x) => x.id), asked('why', 10)[0]!.id]);
  const s = armStats(a, answered);
  assert.ok(weightFor(s, 'answer:want') > 1);
  assert.ok(weightFor(s, 'why') < 1);
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('it writes only its own scorecard, never a claim; snapshots are kept for rollback', async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO podcast_episodes (user_id, title, status, script, outline) VALUES ($1, 'e', 'ready', 's', $2)`,
    [user, JSON.stringify({ planner: 'v2', plan: { items: [{ id: 'answer:x', register: 'asked', facts: { domainId: 'want' } }], reflection: { whyId: 'w9' } } })]);
  const before = await db.query<{ t: string; n: number }>(`SELECT 'assertions' t, count(*)::int n FROM assertions UNION ALL SELECT 'answers', count(*)::int FROM question_answers UNION ALL SELECT 'patterns', count(*)::int FROM behavior_patterns UNION ALL SELECT 'whys', count(*)::int FROM behavior_pattern_whys UNION ALL SELECT 'hyp', count(*)::int FROM hypotheses`).catch(() => db.query<{ t: string; n: number }>(`SELECT 'assertions' t, count(*)::int n FROM assertions UNION ALL SELECT 'answers', count(*)::int FROM question_answers UNION ALL SELECT 'patterns', count(*)::int FROM behavior_patterns UNION ALL SELECT 'whys', count(*)::int FROM behavior_pattern_whys`));
  const writes: string[] = [];
  const realFrom = supabase.from;
  Object.assign(supabase, { from: (t: string) => { const q = realFrom(t) as any; for (const m of ['insert', 'update', 'upsert', 'delete']) { const f = q[m].bind(q); q[m] = (...a: unknown[]) => { writes.push(t); return f(...a); }; } return q; } });
  try {
    await refreshLearning(user, { now: new Date('2026-10-20') });
    await refreshLearning(user, { now: new Date('2026-10-21') });
  } finally { Object.assign(supabase, { from: realFrom }); }
  assert.deepEqual([...new Set(writes)], ['user_preferences']);
  const after = await db.query<{ t: string; n: number }>(before.rows.map((r) => `SELECT '${r.t}' t, count(*)::int n FROM ${({ assertions: 'assertions', answers: 'question_answers', patterns: 'behavior_patterns', whys: 'behavior_pattern_whys', hyp: 'hypotheses' } as Record<string, string>)[r.t]}`).join(' UNION ALL '));
  assert.deepEqual(after.rows, before.rows);
  const l = await readLearning(user);
  assert.equal(l.history.length, 2);
  assert.deepEqual(l.current?.arms.map((a) => a.arm), ['answer:want', 'why']);
});
