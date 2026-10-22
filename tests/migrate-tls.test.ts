import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { databaseTls, migrationClientConfig, TLS_URL_PARAMS } from '../src/db/tls';

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

const read = (p: string) => `cert at ${p}`;
const CA = { DATABASE_CA_CERT: '/ca.crt' };

// Integrator review of #134: pg lays the parsed connection string over `ssl`.
test('a TLS parameter in DATABASE_URL is refused, never allowed to override verification', () => {
  for (const query of [
    'sslmode=no-verify', 'sslmode=disable', 'ssl=0', 'ssl=false', 'uselibpqcompat=true&sslmode=require',
    'sslrootcert=/tmp/other.crt', 'sslcert=/c', 'sslkey=/k', 'sslnegotiation=direct', 'SSLMODE=disable',
  ]) {
    assert.throws(() => migrationClientConfig(`${URL}?${query}`, CA, read), /DATABASE_URL sets .*: remove it/, query);
  }
  assert.equal(TLS_URL_PARAMS.length, 7);
});

test('the refusal never echoes the URL or its password', () => {
  const secret = 'postgres://postgres:hunter2pw@db.invalid:5432/postgres?sslmode=no-verify';
  assert.throws(() => migrationClientConfig(secret, CA, read), (e: unknown) => e instanceof Error && !e.message.includes('hunter2pw'));
  assert.throws(() => migrationClientConfig('not a url hunter2pw', CA, read), (e: unknown) => e instanceof Error && !e.message.includes('hunter2pw'));
});

test('a real pg Client built from the config verifies against the CA', () => {
  // What pg itself ends up with after merging the connection string (no connection is made).
  const client = new Client(migrationClientConfig(`${URL}?application_name=migrate`, CA, read)) as unknown as {
    connectionParameters: { ssl: { rejectUnauthorized?: boolean; ca?: string } };
  };
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(client.connectionParameters.ssl.ca, 'cert at /ca.crt');
});

test('a URL that would have overridden it is stopped before pg sees it', () => {
  // The bug the refusal prevents, shown on pg itself: the parsed URL wins over `ssl`.
  const unsafe = new Client({ connectionString: `${URL}?sslmode=no-verify`, ssl: { ca: 'x', rejectUnauthorized: true } }) as unknown as {
    connectionParameters: { ssl: { rejectUnauthorized?: boolean } | boolean };
  };
  assert.notEqual((unsafe.connectionParameters.ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized, true);
  assert.throws(() => migrationClientConfig(`${URL}?sslmode=no-verify`, CA, read));
});

const ROOT = join(__dirname, '..');
function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? sources(join(dir, d.name)) : /\.(ts|js|mjs|cjs)$/.test(d.name) ? [join(dir, d.name)] : []);
}

test('db:migrate builds its client from migrationClientConfig, and nothing else opens a pg connection', () => {
  assert.match(readFileSync(join(ROOT, 'scripts/migrate.ts'), 'utf8'), /new Client\(migrationClientConfig\(/);
  for (const file of [...sources('src'), ...sources('scripts')]) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const clients = text.match(/new\s+(pg\.)?(Client|Pool)\s*\(/g) ?? [];
    if (file === 'scripts/migrate.ts') {
      assert.equal(clients.length, 1, file);
      continue;
    }
    assert.deepEqual(clients, [], `${file} opens a pg connection outside src/db/tls.ts`);
    assert.equal(/rejectUnauthorized:\s*false/.test(text), false, file);
  }
});
