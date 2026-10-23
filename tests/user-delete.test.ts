import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { deleteEverything, PAGE, type DeleteEverythingDeps, type SweepBucket } from '../src/users/delete-everything';
import { makeUsersRouter } from '../src/routes/users';
import { requireInternalSecret } from '../src/middleware/internal-auth';

/**
 * BE0.6: deleting an account revokes the person's grants and deletes every
 * file of theirs, and only theirs; a second call finds nothing and says so.
 */

// ── A storage that behaves like Supabase's: folders by "/", pages of at most 1,000 ──

class FakeStorage {
  readonly buckets = new Map<string, Set<string>>();
  readonly listCalls: Array<{ bucket: string; prefix: string; limit: number; offset: number }> = [];
  readonly removeCalls: Array<{ bucket: string; paths: string[] }> = [];
  failList = new Set<string>();
  /** A bucket whose remove() refuses from its Nth call on (0 = every call). */
  failRemoveFrom = new Map<string, number>();
  /** Names a broken listing returns as is (to prove they are refused). */
  extraNames = new Map<string, string[]>();

  put(bucket: string, ...paths: string[]) {
    const set = this.buckets.get(bucket) ?? new Set<string>();
    for (const p of paths) set.add(p);
    this.buckets.set(bucket, set);
  }
  has(bucket: string, path: string) { return this.buckets.get(bucket)?.has(path) ?? false; }
  all(bucket: string) { return [...(this.buckets.get(bucket) ?? [])]; }

  bucket = (name: string): SweepBucket => ({
    list: async (prefix, { limit, offset }) => {
      this.listCalls.push({ bucket: name, prefix, limit, offset });
      if (this.failList.has(name)) return { data: null, error: { message: `cannot list ${prefix}` } };
      const children = new Map<string, string | null>();
      for (const path of this.buckets.get(name) ?? []) {
        if (!path.startsWith(`${prefix}/`)) continue;
        const rest = path.slice(prefix.length + 1);
        const slash = rest.indexOf('/');
        if (slash === -1) children.set(rest, 'file-id');
        else if (!children.has(rest.slice(0, slash))) children.set(rest.slice(0, slash), null);
      }
      for (const n of this.extraNames.get(`${name}:${prefix}`) ?? []) children.set(n, 'file-id');
      const sorted = [...children.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      // Supabase caps a page at 1,000 whatever is asked.
      const page = sorted.slice(offset, offset + Math.min(limit, 1000)).map(([n, id]) => ({ name: n, id }));
      return { data: page, error: null };
    },
    remove: async (paths) => {
      const nth = this.removeCalls.filter((c) => c.bucket === name).length;
      this.removeCalls.push({ bucket: name, paths: [...paths] });
      const from = this.failRemoveFrom.get(name);
      if (from !== undefined && nth >= from) return { data: null, error: { message: `cannot remove ${paths[0]}` } };
      const set = this.buckets.get(name) ?? new Set<string>();
      const removed = paths.filter((p) => set.delete(p)).map((p) => ({ name: p }));
      return { data: removed, error: null };
    },
  });
}

// ── The database ─────────────────────────────────────────────────────────────

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
});

async function connection(userId: string, provider: string, mode = 'oauth_api'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO integration_connections (user_id, provider_id, collection_mode) VALUES ($1, $2, $3) RETURNING id`,
    [userId, provider, mode],
  );
  return rows[0]!.id;
}
async function importRow(userId: string, connectionId: string, path: string) {
  await db.query(
    `INSERT INTO integration_imports (user_id, connection_id, storage_path, original_filename, sha256) VALUES ($1, $2, $3, 'archive.zip', $4)`,
    [userId, connectionId, path, `sha-${Math.random()}`],
  );
}
async function assetRow(userId: string, connectionId: string, bucket: string, path: string) {
  await db.query(
    `INSERT INTO source_assets (user_id, connection_id, provider_object_type, provider_object_id, asset_role, storage_bucket, storage_path, sha256)
     VALUES ($1, $2, 'photo', $3, 'original', $4, $5, $6)`,
    [userId, connectionId, `obj-${Math.random()}`, bucket, path, `sha-${Math.random()}`],
  );
}
const rowCount = async (userId: string) => (await db.query<{ n: number }>(
  `SELECT (SELECT count(*) FROM integration_connections WHERE user_id = $1)
        + (SELECT count(*) FROM integration_imports WHERE user_id = $1)
        + (SELECT count(*) FROM source_assets WHERE user_id = $1) AS n`, [userId])).rows[0]!.n;

/** One person with files in every bucket, grants, and rows pointing at files. */
async function person(storage: FakeStorage, opts: { manyEpisodes?: number } = {}) {
  const id = await insertUser(db);
  const gmail = await connection(id, 'gmail');
  await connection(id, 'youtube'); // the same Google grant as gmail
  const archive = await connection(id, 'takeout', 'data_export');
  const files = {
    'podcast-audio': [`podcasts/${id}/run-1.mp3`, `podcasts/${id}/run-2.mp3`],
    'brief-audio': [`${id}/brief-1-20261022.mp3`],
    // Rows name these; the import one is not under the person's folder at all.
    'integration-imports': [`uploads/${id}-archive.zip`, `${id}/second.zip`],
    'integration-media': [`${id}/media/photo-1.jpg`],
    'integration-evidence': [`${id}/a/b/evidence.json`],
  } as Record<string, string[]>;
  for (let i = 0; i < (opts.manyEpisodes ?? 0); i += 1) files['podcast-audio']!.push(`podcasts/${id}/bulk-${String(i).padStart(5, '0')}.mp3`);
  for (const [bucket, paths] of Object.entries(files)) storage.put(bucket, ...paths);
  await importRow(id, archive, `uploads/${id}-archive.zip`);
  await importRow(id, archive, `${id}/second.zip`);
  await assetRow(id, gmail, 'integration-media', `${id}/media/photo-1.jpg`);
  // A row whose file lives in a bucket no prefix covers: found through the row only.
  await assetRow(id, gmail, 'legacy-assets', `assets/${id}-old.bin`);
  storage.put('legacy-assets', `assets/${id}-old.bin`);
  files['legacy-assets'] = [`assets/${id}-old.bin`];
  return { id, files, token: `refresh-${id}` };
}

function depsFor(storage: FakeStorage, tokens: Record<string, string>, opts: { revokeOk?: boolean } = {}) {
  const revoked: string[] = [];
  const logs: string[] = [];
  const deps: DeleteEverythingDeps = {
    db: supabaseOnPglite(db) as unknown as DeleteEverythingDeps['db'],
    storage: storage.bucket,
    revoke: {
      // Every Google connection of a person carries their one grant.
      loadCredentials: async (userId) => ({ refresh_token: tokens[userId] }),
      revokeGoogleToken: async (token) => { revoked.push(token); return opts.revokeOk ?? true; },
    },
    now: () => new Date('2026-10-23T10:00:00Z'),
    log: (line) => logs.push(line),
  };
  return { deps, revoked, logs };
}

const ZERO = { 'podcast-audio': 0, 'brief-audio': 0, 'integration-imports': 0, 'integration-media': 0, 'integration-evidence': 0 };

test('one person\'s grants and files go, another person\'s stay, and no row is deleted', async () => {
  const storage = new FakeStorage();
  const alice = await person(storage, { manyEpisodes: 2500 });
  const bob = await person(storage);
  const rowsBefore = await rowCount(alice.id);
  const { deps, revoked, logs } = depsFor(storage, { [alice.id]: alice.token, [bob.id]: bob.token });

  const report = await deleteEverything(alice.id, deps);

  assert.deepEqual(report, {
    grantsRevoked: 1, // gmail and youtube share one grant: revoked once
    grantsFailed: 0,
    objectsDeleted: { ...ZERO, 'podcast-audio': 2502, 'brief-audio': 1, 'integration-imports': 2, 'integration-media': 1, 'integration-evidence': 1, 'legacy-assets': 1 },
    ok: true,
    failedSteps: [],
  });
  assert.deepEqual(revoked, [alice.token], 'only her grant');
  for (const [bucket, paths] of Object.entries(alice.files)) for (const p of paths) assert.equal(storage.has(bucket, p), false, `${bucket} kept one of hers`);
  for (const [bucket, paths] of Object.entries(bob.files)) for (const p of paths) assert.equal(storage.has(bucket, p), true, `${bucket} lost one of his`);
  assert.equal(await rowCount(alice.id), rowsBefore, 'rows are the backend\'s to delete');

  // Paged: never more than 1,000 asked for or removed at once, and the bulk folder took several pages.
  assert.ok(storage.listCalls.every((c) => c.limit === PAGE));
  assert.ok(storage.removeCalls.every((c) => c.paths.length <= PAGE));
  assert.ok(storage.listCalls.filter((c) => c.prefix === `podcasts/${alice.id}` && c.offset > 0).length >= 2);
  // Every listing started from her id; nothing of Bob's was ever asked for or removed.
  assert.ok(storage.listCalls.every((c) => c.prefix.includes(alice.id)));
  assert.ok(storage.removeCalls.every((c) => c.paths.every((p) => p.includes(alice.id) && !p.includes(bob.id))));

  // Her connections say the grant is gone; his are untouched.
  const { rows } = await db.query<{ user_id: string; status: string; revoked: string | null }>(
    `SELECT user_id, status, metadata->>'grant_revoked_at' AS revoked FROM integration_connections WHERE collection_mode = 'oauth_api' AND user_id IN ($1, $2)`, [alice.id, bob.id]);
  for (const r of rows) {
    if (r.user_id === alice.id) assert.deepEqual([r.status, r.revoked], ['disconnected', '2026-10-23T10:00:00.000Z']);
    else assert.deepEqual([r.status, r.revoked], ['connected', null]);
  }

  // Logs: counts and her id only.
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, new RegExp(`^\\[user-delete\\] user=${alice.id} grantsRevoked=1 grantsFailed=0 objects=2508 ok=true$`));
});

test('a second call finds nothing left: zeros and ok', async () => {
  const storage = new FakeStorage();
  const alice = await person(storage);
  const first = depsFor(storage, { [alice.id]: alice.token });
  assert.equal((await deleteEverything(alice.id, first.deps)).ok, true);

  const second = depsFor(storage, { [alice.id]: alice.token });
  const report = await deleteEverything(alice.id, second.deps);
  assert.deepEqual(report, { grantsRevoked: 0, grantsFailed: 0, objectsDeleted: { ...ZERO, 'legacy-assets': 0 }, ok: true, failedSteps: [] });
  assert.deepEqual(second.revoked, [], 'a revoked grant is not revoked again');
});

test('a grant that cannot be revoked is reported, the files still go, and the next call tries it again', async () => {
  const storage = new FakeStorage();
  const alice = await person(storage);
  const failing = depsFor(storage, { [alice.id]: alice.token }, { revokeOk: false });

  const report = await deleteEverything(alice.id, failing.deps);
  assert.equal(report.grantsRevoked, 0);
  assert.equal(report.grantsFailed, 1);
  assert.equal(report.ok, false, 'a failed grant is never hidden');
  for (const [bucket, paths] of Object.entries(alice.files)) for (const p of paths) assert.equal(storage.has(bucket, p), false);
  assert.match(failing.logs.at(-1)!, /grantsFailed=1 .*ok=false/);

  const retry = depsFor(storage, { [alice.id]: alice.token });
  const again = await deleteEverything(alice.id, retry.deps);
  assert.deepEqual(retry.revoked, [alice.token]);
  assert.deepEqual([again.grantsRevoked, again.grantsFailed, again.ok], [1, 0, true]);
});

test('a bucket that cannot be listed is reported by name, and every other bucket is still swept', async () => {
  const storage = new FakeStorage();
  const alice = await person(storage);
  storage.failList.add('brief-audio');
  const { deps, logs } = depsFor(storage, { [alice.id]: alice.token });

  const report = await deleteEverything(alice.id, deps);
  assert.equal(report.ok, false);
  assert.deepEqual(report.failedSteps, ['brief-audio']);
  assert.equal(storage.has('brief-audio', alice.files['brief-audio']![0]!), true);
  assert.equal(storage.all('podcast-audio').some((p) => p.includes(alice.id)), false);
  // The storage error carried a path; the log never does.
  assert.ok(logs.every((l) => !l.includes('cannot list') && !l.includes('/')));
});

test('a removal refused half way is reported, and what did go is still counted', async () => {
  const storage = new FakeStorage();
  const alice = await person(storage, { manyEpisodes: 2500 });
  storage.failRemoveFrom.set('podcast-audio', 1); // the first 1,000 go, then storage refuses
  const { deps, logs } = depsFor(storage, { [alice.id]: alice.token });

  const report = await deleteEverything(alice.id, deps);
  assert.equal(report.ok, false);
  assert.deepEqual(report.failedSteps, ['podcast-audio']);
  assert.equal(report.objectsDeleted['podcast-audio'], 1000);
  assert.equal(report.objectsDeleted['brief-audio'], 1, 'the other buckets still went');
  assert.equal(storage.all('podcast-audio').length, 1502);
  assert.ok(logs.every((l) => !l.includes('cannot remove')));
});

test('a listed name that would leave the person\'s folder is refused, never removed', async () => {
  const storage = new FakeStorage();
  const alice = await person(storage);
  const bob = await person(storage);
  storage.extraNames.set(`podcast-audio:podcasts/${alice.id}`, ['..']);
  const { deps } = depsFor(storage, { [alice.id]: alice.token, [bob.id]: bob.token });

  const report = await deleteEverything(alice.id, deps);
  assert.equal(report.ok, false);
  assert.deepEqual(report.failedSteps, ['podcast-audio']);
  assert.ok(storage.removeCalls.every((c) => c.paths.every((p) => !p.includes('..'))));
  for (const p of bob.files['podcast-audio']!) assert.equal(storage.has('podcast-audio', p), true);
});

test('logs never carry a path, a file name or a token', async () => {
  const storage = new FakeStorage();
  const alice = await person(storage);
  const { deps, logs } = depsFor(storage, { [alice.id]: alice.token }, { revokeOk: false });
  await deleteEverything(alice.id, deps);
  const secrets = [alice.token, ...Object.values(alice.files).flat()];
  for (const line of logs) {
    for (const s of secrets) assert.equal(line.includes(s), false);
    assert.equal(line.replace(alice.id, '').match(/[0-9a-f]{8}-[0-9a-f]{4}/), null, 'no other id');
    assert.equal(/\.mp3|\.zip|\.jpg|\.json|\//.test(line), false);
  }
});

// ── The door ─────────────────────────────────────────────────────────────────

let server: Server;
let base: string;
const calls: string[] = [];
let nextOk = true;
before(async () => {
  process.env.INTERNAL_API_SECRET = 'test-secret';
  const app = express();
  app.use(express.json());
  app.use('/users', requireInternalSecret, makeUsersRouter({
    deleteEverything: async (userId) => {
      calls.push(userId);
      return { grantsRevoked: 0, grantsFailed: nextOk ? 0 : 1, objectsDeleted: {}, ok: nextOk, failedSteps: nextOk ? [] : ['grants'] };
    },
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const USER = '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b';
const post = async (path: string, body: unknown, secret: string | null = 'test-secret') => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) headers['x-internal-secret'] = secret;
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

test('the door refuses a caller without the internal secret, and deletes nothing', async () => {
  calls.length = 0;
  assert.equal((await post(`/users/${USER}/delete`, { confirm: 'delete' }, null)).status, 401);
  assert.equal((await post(`/users/${USER}/delete`, { confirm: 'delete' }, 'wrong')).status, 401);
  assert.deepEqual(calls, []);
});

test('the door refuses a body without confirm "delete", and an id that is not a UUID', async () => {
  calls.length = 0;
  assert.equal((await post(`/users/${USER}/delete`, {})).status, 400);
  assert.equal((await post(`/users/${USER}/delete`, { confirm: 'yes' })).status, 400);
  assert.equal((await post(`/users/${USER}/delete`, { confirm: true })).status, 400);
  assert.equal((await post('/users/not-a-uuid/delete', { confirm: 'delete' })).status, 400);
  assert.equal((await post('/users/..%2F..%2Fx/delete', { confirm: 'delete' })).status, 400);
  assert.deepEqual(calls, []);
});

test('the door answers the report: 200 when everything is gone, 500 with the report when a step did not finish', async () => {
  calls.length = 0;
  nextOk = true;
  const done = await post(`/users/${USER}/delete`, { confirm: 'delete' });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  nextOk = false;
  const partial = await post(`/users/${USER}/delete`, { confirm: 'delete' });
  assert.equal(partial.status, 500);
  assert.deepEqual([partial.body.ok, partial.body.grantsFailed, partial.body.failedSteps], [false, 1, ['grants']]);
  assert.deepEqual(calls, [USER, USER]);
});
