/** R1.1: links become reference items with your words as their reason. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks, captureReferences } from '../src/reference/capture';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

test('links come out with the message\'s own words as their reason', () => {
  assert.deepEqual(extractLinks('for the raise, read this https://a.com/seed. and https://b.org/x'), [
    { url: 'https://a.com/seed', intent: 'for the raise, read this and' },
    { url: 'https://b.org/x', intent: 'for the raise, read this and' },
  ]);
  assert.deepEqual(extractLinks('https://only.link/'), [{ url: 'https://only.link/', intent: null }]);
  assert.deepEqual(extractLinks('no links here'), []);
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('against the database: sent links are captured once; links in synced mail are not', async () => {
  const u = await insertUser(db);
  await db.query(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'text_entry', 'pricing ideas https://p.com/pricing'), ($1, 'gmail', 'newsletter https://spam.com')`, [u]);
  const now = new Date();
  assert.deepEqual(await captureReferences(u, 14, supabase, now), { scanned: 1, captured: 1 });
  await captureReferences(u, 14, supabase, now);
  const { rows } = await db.query<{ url: string; intent: string; status: string }>(`SELECT url, intent, status FROM reference_items WHERE user_id = $1`, [u]);
  assert.deepEqual(rows, [{ url: 'https://p.com/pricing', intent: 'pricing ideas', status: 'new' }], 'once, with its reason; synced mail is not a save');
});
