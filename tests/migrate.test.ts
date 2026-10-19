import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPlan, plan, recordedMigrations, LEDGER_TABLE, type Executor } from '../src/db/migrate';
import { freshDatabase, migrationFiles, type PGlite } from './support/fresh-database';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const read = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8');

/** PGlite as an Executor: multi-statement SQL without parameters goes through exec. */
const executor = (db: PGlite): Executor => ({
  async query(sql, params) {
    if (params?.length) return db.query(sql, params);
    const results = await db.exec(sql);
    return { rows: results.at(-1)?.rows ?? [] };
  },
});

test('plan: only what is not recorded is applied, in order', () => {
  const p = plan(['102.sql', '100.sql', '101.sql'], new Set(['100.sql']));
  assert.deepEqual(p, { alreadyRecorded: ['100.sql'], toBaseline: [], toApply: ['101.sql', '102.sql'] });
});

test('plan: a baseline adopts the hand-applied past without running it', () => {
  const p = plan(['100.sql', '101.sql', '102.sql'], new Set(), '101.sql');
  assert.deepEqual(p.toBaseline, ['100.sql', '101.sql']);
  assert.deepEqual(p.toApply, ['102.sql']);
});

test('plan: a baseline that names no real file is refused, not guessed', () => {
  assert.throws(() => plan(['100.sql'], new Set(), '999.sql'), /not a migration file/);
});

test('adopting a database applied by hand, then applying the rest, matches a clean build', async () => {
  // A database like production: base schema plus migrations through 114,
  // applied by hand, with no record of any of it.
  const { db } = await freshDatabase({ through: '114_raw_content_retry.sql' });
  const ex = executor(db);

  const files = migrationFiles();
  const first = plan(files, await recordedMigrations(ex), '114_raw_content_retry.sql');
  const result = await applyPlan(ex, first, read);

  assert.equal(result.failed, undefined, JSON.stringify(result.failed));
  assert.deepEqual(result.applied, files.filter((f) => f > '114_raw_content_retry.sql'));

  // Running it again does nothing.
  const second = plan(files, await recordedMigrations(ex));
  assert.deepEqual(second.toApply, []);

  const { rows } = await db.query<{ how: string; n: number }>(`SELECT how, count(*)::int AS n FROM ${LEDGER_TABLE} GROUP BY how ORDER BY how`);
  assert.deepEqual(rows.map((r) => r.how), ['applied', 'baseline']);
});

test('a migration that fails leaves nothing half-done, and stops the run', async () => {
  const { db } = await freshDatabase({ through: '' });
  const ex = executor(db);
  const broken = 'CREATE TABLE half_done (id int); SELECT this_function_does_not_exist();';
  const result = await applyPlan(ex, { alreadyRecorded: [], toBaseline: [], toApply: ['900_broken.sql', '901_after.sql'] },
    (f) => (f === '900_broken.sql' ? broken : 'CREATE TABLE after_it (id int);'));

  assert.equal(result.failed?.file, '900_broken.sql');
  assert.deepEqual(result.applied, [], 'nothing after a failure runs');
  const { rows } = await db.query(`SELECT to_regclass('half_done') AS t, to_regclass('after_it') AS u`);
  assert.deepEqual(rows[0], { t: null, u: null }, 'the failed migration rolled back completely');
  assert.equal((await recordedMigrations(ex)).has('900_broken.sql'), false, 'and is not recorded as applied');
});

test('a preview changes nothing: it does not even create the ledger', async () => {
  const { db } = await freshDatabase({ through: '' });
  const recorded = await recordedMigrations(executor(db), { create: false });
  assert.equal(recorded.size, 0);
  const { rows } = await db.query(`SELECT to_regclass('${LEDGER_TABLE}') AS t`);
  assert.equal((rows[0] as any).t, null);
});
