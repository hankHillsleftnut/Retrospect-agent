/** Goal 7: goals merge, expire, and are never deleted. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { planLifecycle, isMentioned, applyGoalLifecycle, type GoalRow } from '../src/goals/lifecycle';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

const now = new Date('2026-10-19T12:00:00Z');
const v = (k: number, j = 0) => Array.from({ length: 8 }, (_, d) => (d === k ? 1 : 0) + j * 0.01);
const g = (id: string, title: string, created: string, vector: number[]): GoalRow => ({ id, title, description: null, created_at: created, updated_at: null, vector });

test('copies merge into the earliest; a mention keeps the whole family alive', () => {
  const goals = [
    g('a', 'Raise money for Retrospect', '2026-06-01T00:00:00Z', v(0)), g('b', 'Raise a seed round', '2026-06-02T00:00:00Z', v(0, 1)),
    g('c', 'Run a marathon', '2026-06-01T00:00:00Z', v(3)), g('d', 'Learn Spanish', '2026-10-01T00:00:00Z', v(5)),
  ];
  const p = planLifecycle(goals, [{ at: '2026-10-10T00:00:00Z', text: 'Talked to two investors about the seed round today.' }], now);
  assert.deepEqual([...p.mergedInto], [['b', 'a']]);
  assert.deepEqual(p.expire, ['c'], 'the marathon expires; the round lives through its copy; Spanish is recent');
});

test('a mention needs two distinctive words, or the only one', () => {
  assert.equal(isMentioned({ title: 'Run a marathon' }, 'signed up for the marathon'), true);
  assert.equal(isMentioned({ title: 'Raise money for Retrospect' }, 'spent money on lunch'), false);
  assert.equal(isMentioned({ title: 'Raise money for Retrospect' }, 'Retrospect needs money'), true);
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('against the database: a dry run changes nothing; applying marks, never deletes', async () => {
  const user = await insertUser(db);
  const add = (title: string) => db.query(`INSERT INTO goals (user_id, title, created_at) VALUES ($1, $2, '2026-06-01T00:00:00Z')`, [user, title]);
  await add('Run a marathon'); await add('Learn piano');
  const dry = await applyGoalLifecycle(user, { dryRun: true, now, db: supabase });
  assert.deepEqual(dry, { goals: 2, merged: 0, expired: 2, remainActive: 0, mentionedRecently: 0 });
  assert.equal((await db.query(`SELECT 1 FROM goals WHERE user_id = $1 AND status = 'active'`, [user])).rows.length, 2);
  await applyGoalLifecycle(user, { now, db: supabase });
  const { rows } = await db.query<{ status: string; is_active: boolean; status_reason: string }>(`SELECT status, is_active, status_reason FROM goals WHERE user_id = $1`, [user]);
  assert.equal(rows.length, 2, 'nothing deleted');
  assert.ok(rows.every((r) => r.status === 'expired' && r.is_active === false && r.status_reason.includes('90 days ago')));
});
