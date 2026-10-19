/**
 * Saving one batch's facts, end to end against a real database: the quote
 * check, the write, and what the run is told.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { writeBatchFacts } from '../src/pipelines/batch-outputs';
import type { DbRawContent, FactCandidate } from '../src/types';

let db: PGlite;

before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const TEXT = 'I skipped Thursday standup. Told myself I was too tired.';

const candidates: FactCandidate[] = [
  { subject: 'Self', predicate: 'skipped_or_avoided', object: 'thursday standup',
    excerpt: 'I skipped Thursday standup', source_index: 0 },
  { subject: 'Self', predicate: 'said_about_self', object: 'too tired',
    excerpt: 'Told myself I was too tired', source_index: 0 },
  { subject: 'Self', predicate: 'felt', object: 'ashamed',
    excerpt: 'I felt deeply ashamed about it', source_index: 0 }, // not in the entry
];

async function journal(userId: string): Promise<DbRawContent> {
  const { rows } = await db.query<DbRawContent>(
    `INSERT INTO raw_content (user_id, content_type, content, content_date)
     VALUES ($1, 'journal_entry', $2, '2026-02-12T09:00:00Z') RETURNING *`,
    [userId, TEXT],
  );
  return rows[0]!;
}

test('real quotes become facts; an invented quote is dropped and counted', async () => {
  const userId = await insertUser(db);
  const rc = await journal(userId);

  const out = await writeBatchFacts({ userId, batch: [rc], candidates, sourceRunId: null });

  assert.equal(out.error, undefined, out.error);
  assert.equal(out.written, 2);
  assert.equal(out.dropped, 1);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM assertions WHERE user_id = $1`, [userId]);
  assert.equal(rows[0]!.n, 2);
});

test('nothing to save makes no database call and reports zero', async () => {
  const out = await writeBatchFacts({ userId: 'unused', batch: [], candidates: [], sourceRunId: null });
  assert.deepEqual(out, { written: 0, dropped: 0, dropReasons: {}, selfNamedLoops: [] });
});
