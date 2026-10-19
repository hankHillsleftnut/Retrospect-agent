/**
 * Which entries an ingest run picks up, against a real database built from the
 * migrations. These are the queries that once let 2,000 entries fall out of
 * reach, so they are checked by what they return, not by what they ask for.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { claimWork } from '../src/pipelines/claim-work';

let db: PGlite;

before(async () => {
  ({ db } = await freshDatabase());
  // Every query the claim makes (and the lease helpers it calls) goes to PGlite.
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

async function entry(
  userId: string,
  label: string,
  fields: { status?: string; createdAt?: string; nextAttemptAt?: string | null } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO raw_content (user_id, content_type, content, processing_status, created_at, next_attempt_at)
     VALUES ($1, 'journal_entry', $2, $3, $4, $5) RETURNING id`,
    [userId, label, fields.status ?? 'pending', fields.createdAt ?? ago(DAY), fields.nextAttemptAt ?? null],
  );
  return rows[0]!.id;
}

async function statusOf(id: string): Promise<string> {
  const { rows } = await db.query<{ processing_status: string }>(
    `SELECT processing_status FROM raw_content WHERE id = $1`, [id]);
  return rows[0]!.processing_status;
}

test('picks up new entries, due retries and stranded old ones — and nothing else', async () => {
  const userId = await insertUser(db);
  const fresh = await entry(userId, 'new this week');
  const due = await entry(userId, 'failed in March, retry due', { createdAt: ago(200 * DAY), nextAttemptAt: ago(60_000) });
  const stranded = await entry(userId, 'pending, older than the window', { createdAt: ago(30 * DAY) });
  const done = await entry(userId, 'already read', { status: 'completed' });
  const notYet = await entry(userId, 'retry not due yet', { nextAttemptAt: new Date(Date.now() + DAY).toISOString() });

  const claim = await claimWork({ userId, daysBack: 7 });
  assert.equal(claim.kind, 'work');
  if (claim.kind !== 'work') return;
  claim.heartbeat.stop();

  assert.deepEqual(new Set(claim.rows.map((r) => r.id)), new Set([fresh, due, stranded]));
  assert.deepEqual(new Set(claim.leasedIds), new Set([fresh, due, stranded]));
  for (const id of [fresh, due, stranded]) assert.equal(await statusOf(id), 'processing');
  assert.equal(await statusOf(done), 'completed');
  assert.equal(await statusOf(notYet), 'pending');
});

test('a second run cannot claim entries the first is still reading', async () => {
  const userId = await insertUser(db);
  await entry(userId, 'one entry');

  const first = await claimWork({ userId, daysBack: 7 });
  assert.equal(first.kind, 'work');
  if (first.kind === 'work') first.heartbeat.stop();

  const second = await claimWork({ userId, daysBack: 7 });
  assert.equal(second.kind, 'empty');
});

test('a dry run reads but leases nothing', async () => {
  const userId = await insertUser(db);
  const id = await entry(userId, 'dry');

  const claim = await claimWork({ userId, daysBack: 7, dryRun: true });
  assert.equal(claim.kind, 'work');
  if (claim.kind !== 'work') return;
  assert.deepEqual(claim.rows.map((r) => r.id), [id]);
  assert.deepEqual(claim.leasedIds, []);
  assert.equal(await statusOf(id), 'pending');
});

test('nothing to do returns empty, with a reason', async () => {
  const userId = await insertUser(db);
  const claim = await claimWork({ userId, daysBack: 7 });
  assert.deepEqual(claim, { kind: 'empty', note: 'No new raw content found.', leasesReclaimed: 0, factsSkippedRows: 0 });
});
