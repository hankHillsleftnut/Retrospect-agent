/**
 * The per-person spending ceiling, against a real database built from the
 * migrations: spend is summed from what runs record, and episodes stop at the cap.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { spendSince, checkDailySpend } from '../src/pipelines/spend-guard';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const NOW = new Date('2026-10-19T22:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

async function run(userId: string, kind: string, usd: number, at: string) {
  await db.query(
    `INSERT INTO pipeline_run_traces (user_id, kind, status, started_at, cost_breakdown) VALUES ($1, $2, 'completed', $3, $4)`,
    [userId, kind, at, JSON.stringify({ est_usd: usd })],
  );
}
async function research(userId: string, usd: number, at: string) {
  await db.query(
    `INSERT INTO question_research_log (user_id, question_id, researched_at, material_until, items_read, outcome, cost_usd)
     VALUES ($1, 12, $2, $2, 1, 'unchanged', $3)`,
    [userId, at, usd],
  );
}

test('spend adds up episodes, reading and research in the window, and ignores older runs', async () => {
  const userId = await insertUser(db);
  await run(userId, 'podcast', 1.9, hoursAgo(2));
  await run(userId, 'ingest', 0.3, hoursAgo(5));
  await research(userId, 0.4, hoursAgo(1));
  await run(userId, 'podcast', 1.9, hoursAgo(30)); // yesterday: outside
  const s = await spendSince(userId, hoursAgo(24));
  assert.equal(Number(s.totalUsd.toFixed(2)), 2.6);
  assert.deepEqual(Object.keys(s.byKind).sort(), ['ingest', 'podcast', 'research']);
});

test('under the cap, an episode may start', async () => {
  const userId = await insertUser(db);
  await run(userId, 'podcast', 1.9, hoursAgo(2));
  const d = await checkDailySpend(userId, { capUsd: 8, now: NOW });
  assert.equal(d.allowed, true);
});

test('at the cap, it is refused, with a message a person can read', async () => {
  const userId = await insertUser(db);
  await run(userId, 'podcast', 4, hoursAgo(3));
  await run(userId, 'podcast', 4.2, hoursAgo(1));
  const d = await checkDailySpend(userId, { capUsd: 8, now: NOW });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.match(d.message, /Daily limit reached: \$8\.20 of \$8/);
});

test('a cap of 0 turns the ceiling off', async () => {
  const userId = await insertUser(db);
  await run(userId, 'podcast', 50, hoursAgo(1));
  assert.equal((await checkDailySpend(userId, { capUsd: 0, now: NOW })).allowed, true);
});

test("one person's spending does not count against another", async () => {
  const heavy = await insertUser(db);
  const light = await insertUser(db);
  await run(heavy, 'podcast', 20, hoursAgo(1));
  assert.equal((await checkDailySpend(light, { capUsd: 8, now: NOW })).allowed, true);
});
