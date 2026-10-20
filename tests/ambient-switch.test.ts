/** AMB: the ambient on/off switch (founder, 20 Oct). */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { isAmbientOn, ambientOffAmong, pendingSentIds, masterOff } from '../src/ambient/switch';
import { SENT_TYPES } from '../src/planner/daily';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('on by default; a person can turn theirs off; the master switch turns everyone off', async () => {
  const a = await insertUser(db), b = await insertUser(db);
  assert.equal(await isAmbientOn(a, supabase, {}), true);
  await db.query(`UPDATE users SET ambient_enabled = false WHERE id = $1`, [b]);
  assert.deepEqual([...(await ambientOffAmong([a, b], supabase, {}))], [b]);
  assert.equal(await isAmbientOn(a, supabase, { AMBIENT_MASTER: 'off' }), false);
  assert.equal(masterOff({ AMBIENT_MASTER: 'OFF' }), true);
});

test('with ambient off, only what the person sent is picked up for reading', async () => {
  const u = await insertUser(db);
  const add = async (type: string) => (await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, $2, 'x') RETURNING id`, [u, type])).rows[0]!.id;
  const note = await add('text_entry');
  await add('calendar'); await add('gmail'); await add('healthkit');
  assert.deepEqual(await pendingSentIds(u, SENT_TYPES, supabase), [note]);
});
