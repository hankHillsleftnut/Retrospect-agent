import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshDatabase } from './support/fresh-database';
import { assertOnlyTestUsers, loadStagingEnv, stagingTls, type Executor } from '../src/db/staging-guard';

const STAGING_FILE = [
  'RETROSPECT_ENV=staging',
  'DATABASE_URL=postgres://staging.invalid/db',
  'SUPABASE_URL=https://staging.invalid',
  'SUPABASE_SERVICE_KEY=test-only-not-a-key',
  'DATABASE_CA_CERT=/ca.crt',
].join('\n');

// Integrator review of #131: an exported production DATABASE_URL must never win.
test('the staging file overrides values already in the process', () => {
  const env: NodeJS.ProcessEnv = { DATABASE_URL: 'postgres://production.invalid/db', RETROSPECT_ENV: 'production' };
  loadStagingEnv('.env.staging', env, () => STAGING_FILE);
  assert.equal(env.DATABASE_URL, 'postgres://staging.invalid/db');
  assert.equal(env.RETROSPECT_ENV, 'staging');
});

test('a variable missing from the staging file is refused, never inherited', () => {
  const env: NodeJS.ProcessEnv = { DATABASE_URL: 'postgres://production.invalid/db' };
  const withoutUrl = STAGING_FILE.split('\n').filter((l) => !l.startsWith('DATABASE_URL=')).join('\n');
  assert.throws(() => loadStagingEnv('.env.staging', env, () => withoutUrl), /missing: DATABASE_URL/);
  assert.equal(env.DATABASE_URL, 'postgres://production.invalid/db', 'nothing was changed');
  assert.throws(() => loadStagingEnv('.env.staging', {}, () => STAGING_FILE.replace('=staging', '=production')), /not "staging"/);
  assert.throws(() => loadStagingEnv('.env.staging', {}, () => { throw new Error('ENOENT'); }), /could not read/);
});

test('the staging connection is verified against the CA certificate, never unverified', () => {
  assert.throws(() => stagingTls({}), /DATABASE_CA_CERT is not set/);
  assert.deepEqual(stagingTls({ DATABASE_CA_CERT: '/ca.crt' }, (p) => `cert at ${p}`), { ca: 'cert at /ca.crt', rejectUnauthorized: true });
});

test('a database with a real user is refused; only test users, or no users table, is staging', async () => {
  const { db } = await freshDatabase();
  await assert.doesNotReject(assertOnlyTestUsers(db), 'an empty users table');
  await db.query(`INSERT INTO users (apple_user_id) VALUES ('dev-test-user:seed-month')`);
  await assert.doesNotReject(assertOnlyTestUsers(db), 'only a seeded test account');
  await db.query(`INSERT INTO users (apple_user_id) VALUES ('001234.abcdef.0123')`);
  await assert.rejects(assertOnlyTestUsers(db), /1 users who are not test accounts/);

  // A row with no Apple subject isn't a test account either.
  const { db: other } = await freshDatabase();
  await other.query('ALTER TABLE users ALTER COLUMN apple_user_id DROP NOT NULL');
  await other.query('INSERT INTO users (email) VALUES (NULL)');
  await assert.rejects(assertOnlyTestUsers(other), /1 users who are not test accounts/);

  const bare: Executor = { query: async <R>() => ({ rows: [{ present: false }] as R[] }) };
  await assert.doesNotReject(assertOnlyTestUsers(bare), 'a fresh database with no users table');
});

// dev:staging runs `--env-file=.env.staging --require dotenv/config`: node's
// --env-file never overrides the shell, so dotenv/config re-reads the file with
// DOTENV_CONFIG_OVERRIDE=true before any module runs.
test('dev:staging sets the env file and the override in the script itself', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const script = pkg.scripts['dev:staging'] ?? '';
  assert.match(script, /DOTENV_CONFIG_PATH=\.env\.staging/);
  assert.match(script, /DOTENV_CONFIG_OVERRIDE=true/);
  assert.match(script, /--require dotenv\/config/);
  assert.match(pkg.scripts['db:migrate:staging'] ?? '', /--staging/);
});

test('the staging service reads its env file over the shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-staging-'));
  const file = join(dir, '.env.staging');
  const run = (override: boolean) => {
    writeFileSync(file, `SUPABASE_URL=https://staging.invalid\nDOTENV_CONFIG_PATH=${file}\n${override ? 'DOTENV_CONFIG_OVERRIDE=true\n' : ''}`);
    const out = spawnSync(process.execPath, [`--env-file=${file}`, '--require', 'dotenv/config', '-e', 'process.stdout.write(process.env.SUPABASE_URL)'], {
      cwd: join(__dirname, '..'),
      env: { PATH: process.env.PATH, SUPABASE_URL: 'https://production.invalid' },
      encoding: 'utf8',
    });
    return out.stdout;
  };
  assert.equal(run(true), 'https://staging.invalid');
  assert.equal(run(false), 'https://production.invalid', 'without the override the shell would win');
});
