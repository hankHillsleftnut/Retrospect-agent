/** The readiness check's queries, against a database built from the real migrations. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { loadOnboardingFacts, stageFor } from '../src/onboarding/pipeline';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('a new person with unread entries is still being read', async () => {
  const userId = await insertUser(db);
  await db.query(`INSERT INTO raw_content (user_id, content_type, content, processing_status) VALUES ($1, 'journal_entry', 'hello', 'pending')`, [userId]);
  const f = await loadOnboardingFacts(userId, supabase, new Date());
  assert.equal(f.outstandingRows, 1);
  assert.equal(f.answers, 0);
  assert.equal(f.episodesReady, 0);
  assert.equal(stageFor(f, new Date()), 'reading');
});

test('once everything is read and quiet, the next step is the first pass', async () => {
  const userId = await insertUser(db);
  await db.query(
    `INSERT INTO raw_content (user_id, content_type, content, processing_status, created_at) VALUES ($1, 'journal_entry', 'hello', 'completed', NOW() - INTERVAL '10 minutes')`,
    [userId],
  );
  const f = await loadOnboardingFacts(userId, supabase, new Date());
  assert.equal(f.outstandingRows, 0);
  assert.equal(f.outstandingJobs, 0);
  assert.equal(f.access, null, 'no users.access column here (no backend 007): behaves as before');
  assert.equal(stageFor(f, new Date()), 'understanding');
});
