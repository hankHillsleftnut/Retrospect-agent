/**
 * BEA.2b: the routes BEA.2 didn't cover, /runs and /integrations, refuse
 * another person's ids. Two users each, over HTTP. The developer's own
 * /runs dashboard (local, not production) keeps its view across users.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { runsRouter } from '../src/routes/runs';
import { integrationsRouter } from '../src/routes/integrations';

let db: PGlite;
let server: Server;
let base = '';
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const app = express();
  app.use(express.json());
  // As a caller holding the internal secret (a backend door): no local-dev view.
  app.use('/runs', runsRouter);
  // As the developer's own dashboard, which requireInternalSecretOrLocalDev marks.
  app.use('/dev/runs', (_req, res, next) => { res.locals.localDev = true; next(); }, runsRouter);
  app.use('/integrations', integrationsRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const one = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method, redirect: 'manual', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
};

async function person() {
  const user = await insertUser(db);
  const run = await one(`INSERT INTO pipeline_run_traces (user_id, kind, status) VALUES ($1, 'ingest', 'completed') RETURNING id`, [user]);
  const connection = await one(
    `INSERT INTO integration_connections (user_id, provider_id, collection_mode) VALUES ($1, $2, 'oauth_api') RETURNING id`, [user, `test-provider-${user.slice(0, 8)}`]);
  const syncRun = await one(`INSERT INTO integration_sync_runs (connection_id, run_type) VALUES ($1, 'incremental_sync') RETURNING id`, [connection]);
  const importId = await one(
    `INSERT INTO integration_imports (user_id, connection_id, storage_path, original_filename) VALUES ($1, $2, 'test/path', 'test.zip') RETURNING id`, [user, connection]);
  return { user, run, connection, syncRun, importId };
}

test("a run is not found for another user, and a caller must say whose runs it wants", async () => {
  const alice = await person(), bob = await person();
  assert.equal((await call('GET', `/runs/${bob.run}?json=1&userId=${alice.user}`)).status, 404);
  assert.equal((await call('GET', `/runs/${bob.run}?json=1&userId=${bob.user}`)).status, 200);
  assert.equal((await call('GET', `/runs/${bob.run}?json=1`)).status, 400, 'no user named');
  assert.equal((await call('GET', `/runs/${bob.run}?json=1&userId=not-a-uuid`)).status, 400);
  assert.equal((await call('GET', `/runs/${alice.run}/compare/${bob.run}?json=1&userId=${alice.user}`)).status, 404);
});

test("listings only show the named user's runs", async () => {
  const alice = await person(), bob = await person();
  const runs = (await call('GET', `/runs?json=1&userId=${alice.user}`)).body.runs as { user_id: string }[];
  assert.ok(runs.length >= 1);
  assert.ok(runs.every((r) => r.user_id === alice.user));
  const users = (await call('GET', `/runs/users?json=1&userId=${alice.user}`)).body.users as { user_id: string }[];
  assert.deepEqual(users.map((u) => u.user_id), [alice.user]);
  const syncs = (await call('GET', `/runs/integrations?json=1&userId=${alice.user}`)).body.integration_runs as { id: string }[];
  assert.ok(syncs.some((s) => s.id === alice.syncRun));
  assert.equal(syncs.some((s) => s.id === bob.syncRun), false);
  assert.equal((await call('GET', '/runs/users?json=1')).status, 400, 'no cross-user view for a secret caller');
});

test("another user's integration run is not found, before anything of theirs is read", async () => {
  const alice = await person(), bob = await person();
  assert.equal((await call('GET', `/runs/integrations/${bob.syncRun}?json=1&userId=${alice.user}`)).status, 404);
  assert.equal((await call('GET', `/runs/integrations/${bob.syncRun}?json=1&userId=${bob.user}`)).status, 200);
});

test("the developer's own dashboard still looks across users", async () => {
  const alice = await person(), bob = await person();
  assert.equal((await call('GET', `/dev/runs/${bob.run}?json=1`)).status, 200);
  const users = (await call('GET', '/dev/runs/users?json=1')).body.users as { user_id: string }[];
  assert.ok([alice.user, bob.user].every((u) => users.some((x) => x.user_id === u)));
});

test("deleting, testing or importing for another user's connection is not found and changes nothing", async () => {
  const alice = await person(), bob = await person();
  const del = await call('POST', `/integrations/connections/${bob.connection}/delete-data`, { userId: alice.user });
  assert.equal(del.status, 404);
  const jobs = await db.query<{ n: number }>(`SELECT count(*)::int n FROM integration_jobs WHERE connection_id = $1`, [bob.connection]);
  assert.equal(jobs.rows[0]!.n, 0, 'no delete job queued');

  assert.equal((await call('POST', `/integrations/test/${bob.connection}`, { userId: alice.user })).status, 404);
  assert.equal((await call('POST', `/integrations/test/${bob.connection}`, {})).status, 400, 'no user named');

  const imp = await call('POST', '/integrations/queue-import', {
    userId: alice.user, providerId: 'test-provider', importId: bob.importId, idempotencyKey: 'import-key-0001',
  });
  assert.equal(imp.status, 404);
  const status = await db.query<{ status: string }>(`SELECT status FROM integration_imports WHERE id = $1`, [bob.importId]);
  assert.notEqual(status.rows[0]!.status, 'queued');

  const own = await call('POST', `/integrations/connections/${alice.connection}/delete-data`, { userId: alice.user });
  assert.equal(own.status, 202, 'your own still works');
});
