/** S1.2b: opening a source shows it in full, and only ever the person's own. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openSource } from '../src/search/source';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('an item and a saved link open in full; someone else\'s is not found', async () => {
  const me = await insertUser(db), other = await insertUser(db);
  const item = (await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'The whole entry, word for word.') RETURNING id`, [me])).rows[0]!.id;
  const saved = (await db.query<{ id: string }>(`INSERT INTO reference_items (user_id, raw_content_id, url, title, summary, intent) VALUES ($1, $2, 'https://a.com', 'Seed rounds', 'A guide.', 'for the raise') RETURNING id`, [me, item])).rows[0]!.id;
  const opened = await openSource(me, 'item', item, supabase);
  assert.deepEqual([opened?.title, opened?.body], ['journal entry', 'The whole entry, word for word.']);
  assert.deepEqual((await openSource(me, 'saved', saved, supabase))?.extra, { url: 'https://a.com', yourReason: 'for the raise' });
  assert.equal(await openSource(other, 'item', item, supabase), null, 'never another person\'s');
});
