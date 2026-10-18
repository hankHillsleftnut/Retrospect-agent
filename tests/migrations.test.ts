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

// ── Migration 119 ───────────────────────────────────────────────────────────

/** A user with a "self" entity and one journal entry to cite. */
async function factSetup() {
  const user = await insertUser(db);
  const { rows: [self] } = await db.query<{ id: string }>(
    `INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`,
    [user],
  );
  const { rows: [entry] } = await db.query<{ id: string }>(
    `INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'I skipped standup') RETURNING id`,
    [user],
  );
  return { user, self: self!.id, entry: entry!.id };
}

const fact = (s: { user: string; self: string }, evidence: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> & { origin_key: string } => ({
  user_id: s.user, subject_entity_id: s.self, predicate: 'skipped_or_avoided',
  object_value: { normalized: 'standup' }, origin_key: `k-${Math.random().toString(36).slice(2)}`,
  evidence, ...extra,
});

async function writeFact(p: unknown): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify(p)]);
  return rows[0]!.id;
}

const countWhere = async (sql: string, params: unknown[]) =>
  Number((await db.query<{ n: string }>(sql, params)).rows[0]!.n);

test('119: a fact and its evidence are saved together', async () => {
  const s = await factSetup();
  const id = await writeFact(fact(s, [{ raw_content_id: s.entry, excerpt: 'I skipped standup' }]));
  assert.equal(await countWhere(`SELECT count(*) AS n FROM assertion_evidence WHERE assertion_id = $1`, [id]), 1);
});

test('119: if the evidence cannot be saved, neither is the fact', async () => {
  // The whole point. The evidence cites a row that does not exist, so its
  // insert fails -- after the fact's insert has already run. The old two-call
  // path left that fact behind, unsupported. Here it must vanish with the error.
  const s = await factSetup();
  const p = fact(s, [{ raw_content_id: s.entry }, { analysis_unit_id: '00000000-0000-0000-0000-000000000001' }]);
  await assert.rejects(() => writeFact(p));
  assert.equal(await countWhere(`SELECT count(*) AS n FROM assertions WHERE origin_key = $1`, [p.origin_key]), 0);
});

test('119: a fact with no evidence is refused', async () => {
  const s = await factSetup();
  const p = fact(s, []);
  assert.equal(await failureCode(`SELECT write_fact($1::jsonb)`, [JSON.stringify(p)]), CHECK_VIOLATION);
  assert.equal(await countWhere(`SELECT count(*) AS n FROM assertions WHERE origin_key = $1`, [p.origin_key]), 0);
});

test("119: evidence from someone else's data is refused", async () => {
  const s = await factSetup();
  const other = await factSetup();
  const p = fact(s, [{ raw_content_id: other.entry }]);
  assert.equal(await failureCode(`SELECT write_fact($1::jsonb)`, [JSON.stringify(p)]), '42501');
});

test('119: saving the same fact again changes nothing it should not', async () => {
  const s = await factSetup();
  const p = fact(s, [{ raw_content_id: s.entry, excerpt: 'I skipped standup' }], { model_version: 'm1' });
  const id = await writeFact(p);
  const before = (await db.query<{ observed_at: string }>(`SELECT observed_at FROM assertions WHERE id = $1`, [id])).rows[0]!;
  await db.query(`UPDATE assertions SET status = 'superseded' WHERE id = $1`, [id]);

  // Replay, without model_version this time.
  const { model_version: _omit, ...replay } = p;
  const again = await writeFact(replay);

  assert.equal(again, id, 'same fact, not a new one');
  const after = (await db.query<{ observed_at: string; status: string; model_version: string }>(
    `SELECT observed_at, status, model_version FROM assertions WHERE id = $1`, [id])).rows[0]!;
  assert.deepEqual(after.observed_at, before.observed_at, 'when it was first seen does not move');
  assert.equal(after.status, 'superseded', 'a replay does not resurrect a retired fact');
  assert.equal(after.model_version, 'm1', 'a writer that omits model_version does not erase it');
  assert.equal(
    await countWhere(`SELECT count(*) AS n FROM assertion_evidence WHERE assertion_id = $1`, [id]),
    1,
    'journal evidence has no source item; a replay must still not duplicate it',
  );
});

test('119: the app cannot call it, only the backend services can', async () => {
  const { rows } = await db.query<{ anon: boolean; authed: boolean; service: boolean }>(
    `SELECT has_function_privilege('anon', 'write_fact(jsonb)', 'EXECUTE') AS anon,
            has_function_privilege('authenticated', 'write_fact(jsonb)', 'EXECUTE') AS authed,
            has_function_privilege('service_role', 'write_fact(jsonb)', 'EXECUTE') AS service`,
  );
  assert.deepEqual(rows[0], { anon: false, authed: false, service: true });
});

// ── Migration 123 ───────────────────────────────────────────────────────────

test('123: restores the voice choice on a database that lost it, and changes nothing where it exists', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '123_users_voice_persona.sql'), 'utf8');

  // Where the column exists (here, from the base schema), running it again is harmless.
  await db.exec(sql);

  // Recreate production's state: no column at all. Then apply.
  await db.exec(`ALTER TABLE users DROP COLUMN voice_persona`);
  await db.exec(sql);
  const user = await insertUser(db);
  const { rows } = await db.query<{ voice_persona: string }>(`SELECT voice_persona FROM users WHERE id = $1`, [user]);
  assert.equal(rows[0]!.voice_persona, 'thoughtful_friend', 'existing and new users get the default voice');
  await db.query(`UPDATE users SET voice_persona = 'wise_mentor' WHERE id = $1`, [user]);
  assert.equal(
    await failureCode(`UPDATE users SET voice_persona = 'robot' WHERE id = $1`, [user]),
    CHECK_VIOLATION,
    'only the three real voices',
  );
});
