import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { databaseTls, migrationClientConfig } from '../src/db/tls';

const URL = 'postgres://db.invalid:5432/postgres';

// Findings log (BE0.S review): db:migrate connected to production with
// rejectUnauthorized: false, so the connection could be intercepted.
test('db:migrate verifies the connection against the CA certificate, in every mode', () => {
  const config = migrationClientConfig(URL, { DATABASE_CA_CERT: '/ca.crt' }, (p) => `cert at ${p}`);
  assert.deepEqual(config, { connectionString: URL, ssl: { ca: 'cert at /ca.crt', rejectUnauthorized: true } });
});

test('without the CA certificate, db:migrate refuses rather than connecting unverified', () => {
  assert.throws(() => migrationClientConfig(URL, {}), /DATABASE_CA_CERT is not set/);
  assert.throws(() => databaseTls({ DATABASE_CA_CERT: '' }), /DATABASE_CA_CERT is not set/);
});

test('no script or source file turns certificate checks off', () => {
  for (const file of ['scripts/migrate.ts', 'src/db/tls.ts', 'src/db/staging-guard.ts']) {
    assert.equal(/rejectUnauthorized:\s*false/.test(readFileSync(join(__dirname, '..', file), 'utf8')), false, file);
  }
});
