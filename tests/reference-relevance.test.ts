/** R1.3: what a saved link bears on, judged and vetted. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { vetRelevance, relatePending } from '../src/reference/relevance';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

test('only real goals and questions survive', () => {
  const items = [{ id: 'a', intent: null, title: 't', summary: 's' }];
  const v = vetRelevance({ links: [{ i: 0, goals: [0, 5, 0], questions: [6, 999] }, { i: 7, goals: [0] }] }, items, [{ id: 'g1' }], new Set([6, 7]));
  assert.deepEqual(v.get('a'), { goalIds: ['g1'], questionIds: [6] });
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('against the database: an enriched link is tied to the goal it serves, once', async () => {
  const u = await insertUser(db);
  const goal = (await db.query<{ id: string }>(`INSERT INTO goals (user_id, title) VALUES ($1, 'Raise a seed round') RETURNING id`, [u])).rows[0]!.id;
  const rc = (await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'text_entry', 'x') RETURNING id`, [u])).rows[0]!.id;
  await db.query(`INSERT INTO reference_items (user_id, raw_content_id, url, status, title, summary, intent) VALUES ($1, $2, 'https://a.com', 'enriched', 'Seed rounds', 'How seed rounds work.', 'for the raise')`, [u, rc]);
  let calls = 0;
  const model = async () => { calls++; return { data: { links: [{ i: 0, goals: [0], questions: [] }] }, usage: { inputTokens: 1, outputTokens: 1 } }; };
  assert.equal((await relatePending(u, { db: supabase, model })).related, 1);
  assert.equal((await relatePending(u, { db: supabase, model })).related, 0, 'never judged twice');
  assert.equal(calls, 1);
  const { rows } = await db.query<{ goal_ids: string[] }>(`SELECT goal_ids FROM reference_items WHERE user_id = $1`, [u]);
  assert.deepEqual(rows[0]!.goal_ids, [goal]);
});
