/** W1.2: each stored item records its trust class, against a database built from the migrations. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { stampTrustClasses } from '../src/brain/trust-stamp';
import { trustForRow } from '../src/brain/trust';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

async function row(userId: string, content_type: string, content: string, metadata: object = {}, authorship = 'self') {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO raw_content (user_id, content_type, content, metadata, authorship) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, content_type, content, JSON.stringify(metadata), authorship]);
  return { id: rows[0]!.id, content_type, content, metadata, authorship };
}

test('a mixed batch is recorded class by class', async () => {
  const userId = await insertUser(db);
  const items = [
    await row(userId, 'journal_entry', 'I skipped the gym again.'),
    await row(userId, 'gmail', 'Email: Your morning brief', { labels: ['INBOX'], from: 'Daybreak Assistant <brief@daybreak.ai>' }, 'other'),
    await row(userId, 'gmail', 'Email: Re: Thursday', { labels: ['SENT'], from: 'me' }, 'other'),
    await row(userId, 'calendar', 'Calendar event: Run club', {}, 'other'),
  ];
  const counts = await stampTrustClasses(items);
  assert.deepEqual(counts, { own_words: 2, automated: 1, record: 1 });
  const { rows } = await db.query<{ content_type: string; trust_class: string }>(
    `SELECT content_type, trust_class FROM raw_content WHERE user_id = $1 ORDER BY created_at`, [userId]);
  assert.deepEqual(rows.map((r) => r.trust_class), ['own_words', 'automated', 'own_words', 'record']);
});

test('a Gmail row without stored labels falls back to its From line', () => {
  assert.equal(trustForRow({ content_type: 'gmail', content: 'Email: Sale!\nFrom: Shop <news@shop.example>' }), 'automated');
  assert.equal(trustForRow({ content_type: 'gmail', content: 'Email: Climbing?\nFrom: Priya Raman <priya@example.com>' }), 'third_party');
});
