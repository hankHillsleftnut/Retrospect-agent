/** W2.6: the pairs it won't decide alone are asked; "same" links them, "different" keeps them apart for good. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { answerHeldPair, heldPairs } from '../src/people/run-resolution';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});
const one = async (sql: string, p: unknown[]) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;

async function setup() {
  const user = await insertUser(db);
  const self = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user]);
  const written = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'person', 'Sam') RETURNING id`, [user]);
  const contact = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'person', 'Sam Ortiz') RETURNING id`, [user]);
  const fact = await one(`INSERT INTO assertions (user_id, subject_entity_id, predicate, object_entity_id, object_value, confidence, origin_key, assertion_kind) VALUES ($1, $2, 'communicated_with', $3, '{}', 0.8, 'k1', 'observed') RETURNING id`, [user, self, written]);
  const pair = await one(`INSERT INTO entity_resolution_candidates (user_id, left_entity_id, right_entity_id, confidence, status, resolver_version) VALUES ($1, $2, $3, 0.5, 'pending', 'test') RETURNING id`, [user, written, contact]);
  return { user, written, contact, fact, pair };
}

test('held pairs come back as a plain question', async () => {
  const s = await setup();
  assert.deepEqual((await heldPairs(s.user)).map((p) => p.question), ['Is the Sam in your writing Sam Ortiz?']);
});

test('"same": their facts move to the contact; the old record is kept, marked merged', async () => {
  const s = await setup();
  assert.deepEqual(await answerHeldPair(s.user, s.pair, 'same'), { status: 'accepted' });
  assert.equal((await db.query<{ o: string }>(`SELECT object_entity_id o FROM assertions WHERE id = $1`, [s.fact])).rows[0]!.o, s.contact);
  assert.equal((await db.query<{ m: string }>(`SELECT merged_into_id m FROM entities WHERE id = $1`, [s.written])).rows[0]!.m, s.contact);
  await assert.rejects(answerHeldPair(s.user, s.pair, 'different'), /no pending pair/);
});

test('"different": nothing moves, and it is kept apart for good', async () => {
  const s = await setup();
  assert.deepEqual(await answerHeldPair(s.user, s.pair, 'different'), { status: 'rejected' });
  assert.equal((await db.query<{ o: string }>(`SELECT object_entity_id o FROM assertions WHERE id = $1`, [s.fact])).rows[0]!.o, s.written);
  assert.equal((await heldPairs(s.user)).length, 0);
});

test("nobody can answer someone else's pair", async () => {
  const s = await setup();
  const other = await insertUser(db);
  await assert.rejects(answerHeldPair(other, s.pair, 'same'));
  assert.equal((await db.query<{ status: string }>(`SELECT status FROM entity_resolution_candidates WHERE id = $1`, [s.pair])).rows[0]!.status, 'pending');
});
