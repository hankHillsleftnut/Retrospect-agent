import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { freshDatabase, insertUser, type MigrationResult, type PGlite } from './support/fresh-database';

/**
 * The migrations, run against real Postgres.
 *
 * Until 18 October 2026 no migration in this project had been executed before it
 * was applied to production by hand -- and the history turned out not to replay
 * at all. These tests make that impossible to regress, and prove that the
 * guarantees each recent migration promises are actually enforced by the
 * database, not merely described in a comment.
 */

let db: PGlite;
let results: MigrationResult[];

before(async () => {
  ({ db, results } = await freshDatabase());
});

/** Run a statement expected to fail; return the Postgres error code. */
async function failureCode(sql: string, params: unknown[] = []): Promise<string | undefined> {
  try {
    await db.query(sql, params);
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

test('the whole migration history replays from scratch', () => {
  // The single most important property: a new environment, a new engineer, or a
  // disaster recovery can rebuild the database from this repository.
  const failed = results.filter((r) => !r.ok);
  assert.deepEqual(
    failed,
    [],
    `migrations that do not apply:\n${failed.map((f) => `  ${f.file}: ${f.error}`).join('\n')}`,
  );
});

// ── Migration 116 ───────────────────────────────────────────────────────────

test('116: a failure can be recorded as "not a failure at all"', async () => {
  const user = await insertUser(db);
  // The retry policy classifies the pipeline's own deliberate skips as
  // not_applicable. Before 116, the database rejected that value.
  await db.query(
    `INSERT INTO raw_content (user_id, content_type, content, failure_kind) VALUES ($1, 'journal_entry', 'x', 'not_applicable')`,
    [user],
  );
  assert.equal(
    await failureCode(
      `INSERT INTO raw_content (user_id, content_type, content, failure_kind) VALUES ($1, 'journal_entry', 'x', 'banana')`,
      [user],
    ),
    CHECK_VIOLATION,
    'and anything else is still refused',
  );
});

test('116: a run can record what extraction discarded', async () => {
  const user = await insertUser(db);
  const { rows } = await db.query<{ extraction_stats: { dropped: number } }>(
    `INSERT INTO pipeline_run_traces (user_id, kind, status, extraction_stats)
     VALUES ($1, 'ingest', 'completed', '{"candidates": 5, "dropped": 2}') RETURNING extraction_stats`,
    [user],
  );
  assert.equal(rows[0]!.extraction_stats.dropped, 2);
});

// ── Migration 117 ───────────────────────────────────────────────────────────

const insertKeyed = (user: string, key: string | null) =>
  `INSERT INTO raw_content (user_id, content_type, content, dedup_key, dedup_strategy)
   VALUES ('${user}', 'healthkit', 'Steps: 1', ${key === null ? 'NULL' : `'${key}'`}, ${key === null ? 'NULL' : `'content_hash'`})`;

test('117: the database refuses a second copy of the same upload', async () => {
  const user = await insertUser(db);
  await db.query(insertKeyed(user, 'k1'));
  assert.equal(await failureCode(insertKeyed(user, 'k1')), UNIQUE_VIOLATION);
});

test('117: rows from before the migration are never blocked', async () => {
  // Every existing row has a null key. The index is partial so it builds
  // against the duplicates already in production and never touches them.
  const user = await insertUser(db);
  await db.query(insertKeyed(user, null));
  await db.query(insertKeyed(user, null));
  await db.query(insertKeyed(user, null));
});

test('117: two people can upload identical content', async () => {
  const a = await insertUser(db);
  const b = await insertUser(db);
  await db.query(insertKeyed(a, 'shared'));
  await db.query(insertKeyed(b, 'shared'));
});

test('117: only a known dedup rule can be recorded', async () => {
  const user = await insertUser(db);
  assert.equal(
    await failureCode(
      `INSERT INTO raw_content (user_id, content_type, content, dedup_key, dedup_strategy)
       VALUES ($1, 'healthkit', 'x', 'k-rule', 'made_up_rule')`,
      [user],
    ),
    CHECK_VIOLATION,
  );
});

// ── Migration 118 ───────────────────────────────────────────────────────────

async function insertPattern(user: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO behavior_patterns (user_id, slug, label, grouping_key)
     VALUES ($1, 'skips', 'Skips standup', $2) RETURNING id`,
    [user, `key-${Math.random().toString(36).slice(2)}`],
  );
  return rows[0]!.id;
}

const insertWhy = (pattern: string, user: string, mechanism: string, retired = false) =>
  `INSERT INTO behavior_pattern_whys (pattern_id, user_id, mechanism${retired ? ', retired_at' : ''})
   VALUES ('${pattern}', '${user}', '${mechanism}'${retired ? ', now()' : ''})`;

test('118: two runs cannot write the same explanation twice', async () => {
  const user = await insertUser(db);
  const pattern = await insertPattern(user);
  await db.query(insertWhy(pattern, user, 'avoidance'));
  assert.equal(await failureCode(insertWhy(pattern, user, 'avoidance')), UNIQUE_VIOLATION);
});

test('118: a pattern can still carry competing explanations', async () => {
  // The constraint is on pattern AND mechanism, deliberately. One explanation
  // per pattern would also stop the race, and would quietly forbid the
  // hypothesis engine from holding "avoidance, or capacity?" side by side.
  const user = await insertUser(db);
  const pattern = await insertPattern(user);
  await db.query(insertWhy(pattern, user, 'avoidance'));
  await db.query(insertWhy(pattern, user, 'capacity'));
});

test('118: a retired explanation does not block a fresh one', async () => {
  const user = await insertUser(db);
  const pattern = await insertPattern(user);
  await db.query(insertWhy(pattern, user, 'avoidance', true));
  await db.query(insertWhy(pattern, user, 'avoidance'));
});
