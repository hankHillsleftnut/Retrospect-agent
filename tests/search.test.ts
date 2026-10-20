/** S1.1: the search wrapper, against a database built from the migrations. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { searchPerson } from '../src/search/search';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('keyword search still works when the query cannot be embedded', async () => {
  const u = await insertUser(db);
  await db.query(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'Woodworking class at Laney on Saturday')`, [u]);
  const hits = await searchPerson(u, 'woodworking class', { db: supabase, embed: async () => null });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.kind, 'item');
  assert.ok(hits[0]!.score > 0);
});
