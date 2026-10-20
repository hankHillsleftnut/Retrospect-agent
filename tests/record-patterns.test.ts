/** W3.2: behaviour read from records becomes patterns at the usual bar. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { DETECTORS, detectRecordInstances, refreshRecordBehaviour } from '../src/brain/record-patterns';
import { objectTokens } from '../src/brain/promoter';
import { refreshTrajectories } from '../src/brain/run-trajectory';
import type { DailySummary } from '../src/brain/daily-summaries';

const day = (d: string, domain: DailySummary['domain'], metrics: DailySummary['metrics'], ids = [`${d}-${domain}`]): DailySummary =>
  ({ day: d, domain, metrics, items: ids.length, source_ids: ids });

test('detectors fire on what was recorded, never on what was not', () => {
  const text = new Map([['a', 'Apple Health summary:\nSteps: 2,100\nExercise: 45 minutes'], ['b', 'Apple Health summary:\nResting heart rate: 60 BPM']]);
  const got = detectRecordInstances([day('2026-10-01', 'health', { steps: 2100, exercise_minutes: 45 }, ['a']), day('2026-10-02', 'health', { resting_heart_rate_bpm: 60 }, ['b'])], text);
  assert.deepEqual(got.map((i) => [i.day, i.detector.id, i.evidence[0]!.excerpt]), [
    ['2026-10-01', 'sedentary', 'Steps: 2,100'],
    ['2026-10-01', 'exercised', 'Exercise: 45 minutes'],
  ], 'no steps or sleep recorded on the 2nd: nothing fires');
});

test('a detector without a verbatim line to cite does not fire', () => {
  assert.deepEqual(detectRecordInstances([day('2026-10-01', 'health', { steps: 500 }, ['x'])], new Map([['x', 'no steps line here']])), []);
});

test('no two detectors share a token, so the promoter cannot fuse them', () => {
  const seen = new Map<string, string>();
  for (const d of DETECTORS) for (const t of objectTokens(d.object)) {
    assert.ok(!seen.has(t), `${d.id} shares "${t}" with ${seen.get(t)}`);
    seen.set(t, d.id);
  }
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('off by default: summaries are built, no facts are written', async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO raw_content (user_id, content_type, content, created_at, metadata) VALUES ($1, 'healthkit', 'Steps: 900', '2026-10-10T08:00:00Z', '{"sync_day":"2026-10-10"}')`, [user]);
  const r = await refreshRecordBehaviour(user, 30, supabase, new Date('2026-10-19T12:00:00Z'));
  assert.equal(r.facts, 0);
  assert.equal(r.summaries, 1);
});

test('gate: four low days and four active days become two separate patterns; twice = once', async () => {
  const user = await insertUser(db);
  const now = new Date('2026-10-19T12:00:00Z');
  const health = (d: string, steps: string) => db.query(
    `INSERT INTO raw_content (user_id, content_type, content, created_at, metadata, trust_class) VALUES ($1, 'healthkit', $2, $3, $4, 'record')`,
    [user, `Apple Health summary:\nSteps: ${steps}\nSleep: 0.0 hours`, `${d}T08:00:00Z`, JSON.stringify({ sync_day: d })]);
  for (const d of ['2026-10-06', '2026-10-08', '2026-10-10', '2026-10-12']) await health(d, '1,800');
  for (const d of ['2026-10-07', '2026-10-09', '2026-10-11', '2026-10-13']) await health(d, '12,400');
  await health('2026-10-14', '5,000');

  const r = await refreshRecordBehaviour(user, 30, supabase, now, { writeFacts: true });
  assert.equal(r.facts, 8, 'eight detected days; the ordinary day and the unrecorded sleep detect nothing');

  const patterns = async () => (await db.query<{ grouping_key: string; status: string; n: number }>(
    `SELECT p.grouping_key, p.status, count(pf.*)::int n FROM behavior_patterns p JOIN behavior_pattern_facts pf ON pf.pattern_id = p.id
     WHERE p.user_id = $1 GROUP BY 1, 2 ORDER BY 1`, [user])).rows;
  const once = await patterns();
  assert.equal(once.length, 2, JSON.stringify(once));
  assert.ok(once.every((p) => p.n === 4), JSON.stringify(once));
  assert.ok(once.every((p) => p.status === 'live'), `four days at 0.5 each clear the standard bar: ${JSON.stringify(once)}`);

  await refreshRecordBehaviour(user, 30, supabase, now, { writeFacts: true });
  assert.deepEqual(await patterns(), once);
  const facts = await db.query(`SELECT 1 FROM assertions WHERE user_id = $1`, [user]);
  assert.equal(facts.rows.length, 8, 'no duplicate facts');
});

test('W3.3b: patterns carry their trajectory and the counts behind it', async () => {
  const user = await insertUser(db);
  const now = new Date('2026-10-19T12:00:00Z');
  const health = (d: string) => db.query(
    `INSERT INTO raw_content (user_id, content_type, content, created_at, metadata) VALUES ($1, 'healthkit', $2, $3, $4)`,
    [user, `Apple Health summary for ${d}:\nSteps: 1,200`, `${d}T08:00:00Z`, JSON.stringify({ sync_day: d })]);
  // One low day four-to-eight weeks ago, ten in the last four weeks (p = 0.012).
  // (2 then 9 would be p = 0.065: "not enough to say", by the declared rule.)
  await health('2026-09-12');
  for (let i = 1; i <= 10; i++) await health(`2026-10-${String(i + 8).padStart(2, '0')}`);
  await refreshRecordBehaviour(user, 60, supabase, now, { writeFacts: true });
  await refreshTrajectories(user, supabase, now);
  const { rows } = await db.query<{ trajectory: string; trajectory_detail: { prior: number; recent: number } }>(
    `SELECT trajectory, trajectory_detail FROM behavior_patterns WHERE user_id = $1`, [user]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.trajectory, 'strengthening');
  assert.deepEqual([rows[0]!.trajectory_detail.prior, rows[0]!.trajectory_detail.recent], [1, 10]);
});

test('review fix: a detected day that no longer qualifies is invalidated, not deleted', async () => {
  const user = await insertUser(db);
  const now = new Date('2026-10-19T12:00:00Z');
  const ids: string[] = [];
  for (const d of ['2026-10-06', '2026-10-08', '2026-10-10', '2026-10-12']) {
    ids.push((await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content, created_at, metadata) VALUES ($1, 'healthkit', $2, $3, $4) RETURNING id`,
      [user, `Apple Health summary for ${d}:\nSteps: 1,500`, `${d}T08:00:00Z`, JSON.stringify({ sync_day: d })])).rows[0]!.id);
  }
  await refreshRecordBehaviour(user, 30, supabase, now, { writeFacts: true });
  // A re-sync shows the 12th was actually active.
  await db.query(`UPDATE raw_content SET content = $2 WHERE id = $1`, [ids[3], 'Apple Health summary for 2026-10-12:\nSteps: 9,500']);
  await refreshRecordBehaviour(user, 30, supabase, now, { writeFacts: true });
  const { rows } = await db.query<{ status: string; n: number }>(`SELECT status, count(*)::int n FROM assertions WHERE user_id = $1 GROUP BY 1 ORDER BY 1`, [user]);
  assert.deepEqual(rows, [{ status: 'active', n: 3 }, { status: 'retired', n: 1 }]);
});
