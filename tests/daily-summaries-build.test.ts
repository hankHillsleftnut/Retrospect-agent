/** W3.1c: summaries are rebuilt from the items, against a database built from the migrations. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { rebuildDailySummaries } from '../src/brain/daily-summaries';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const now = new Date('2026-10-19T12:00:00Z');
const state = async (user: string) => (await db.query<{ day: string; domain: string; items: number; metrics: Record<string, unknown> }>(`SELECT day::text, domain, items, metrics FROM daily_summaries WHERE user_id = $1 ORDER BY day, domain`, [user])).rows;

test('a rebuild summarises the window, twice equals once, and a removed item disappears', async () => {
  const user = await insertUser(db);
  const add = async (type: string, content: string, at: string, metadata: object = {}) =>
    (await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content, created_at, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [user, type, content, at, JSON.stringify(metadata)])).rows[0]!.id;
  await add('journal_entry', 'twelve chars', '2026-10-14T18:00:00Z');
  const gone = await add('journal_entry', 'abc', '2026-10-15T18:00:00Z');
  await add('healthkit', 'Apple Health summary:\nSteps: 9,000\nSleep: 0.0 hours', '2026-10-15T08:00:00Z', { sync_day: '2026-10-14' });
  await add('journal_entry', 'old', '2026-01-01T18:00:00Z');

  const r = await rebuildDailySummaries(user, 30, supabase, now);
  const once = await state(user);
  assert.deepEqual(once.map((x) => [x.day, x.domain, x.items]), [
    ['2026-10-14', 'health', 1], ['2026-10-14', 'own_words', 1], ['2026-10-15', 'own_words', 1],
  ], 'January is outside the 30-day window');
  assert.deepEqual(once[0]!.metrics, { steps: 9000 });
  assert.equal(once[1]!.metrics.chars, 12);
  assert.deepEqual(r, { days: 2, rows: 3 });

  await rebuildDailySummaries(user, 30, supabase, now);
  assert.deepEqual(await state(user), once, 'twice = once');

  await db.query(`DELETE FROM raw_content WHERE id = $1`, [gone]);
  await rebuildDailySummaries(user, 30, supabase, now);
  assert.equal((await state(user)).length, 2);
});
