/**
 * BEA.7: episode audio is a private object with a signed, expiring link, not
 * a public permanent URL. Storage is faked (it is Supabase's, not under test);
 * the database is real, built from the migrations.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { config } from '../src/config';
import {
  audioPathFromPublicUrl, episodeAudioPath, legacyPublicAudioUrl, signedAudioUrl, signedAudioUrls, storeEpisodeAudio, audioPathOf,
  SIGNED_AUDIO_TTL_SECONDS, type AudioStorage,
} from '../src/services/audio-storage';
import { makePodcastsRouter } from '../src/routes/podcasts';

const PUBLIC_PREFIX = `${config.supabase.url}/storage/v1/object/public/podcast-audio/`;
const NOW = new Date('2026-10-22T12:00:00Z');

/** A storage that remembers uploads and signs with a token; it has no getPublicUrl, so any call to it would throw. */
function fakeStorage(signError: string | null = null) {
  const uploads: Array<{ path: string; bytes: number; contentType?: string }> = [];
  const signed: Array<{ path: string; ttl: number }> = [];
  const storage = {
    upload: async (path: string, body: Buffer, opts?: { contentType?: string }) => { uploads.push({ path, bytes: body.length, contentType: opts?.contentType }); return { data: { path }, error: null }; },
    createSignedUrl: async (path: string, ttl: number) => {
      signed.push({ path, ttl });
      return signError ? { data: null, error: { message: signError } } : { data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/podcast-audio/${path}?token=t${ttl}` }, error: null };
    },
  } as unknown as AudioStorage;
  return { storage, uploads, signed };
}

// ── The helper ───────────────────────────────────────────────────────────────

test('new episodes store a path, not a public URL', async () => {
  const { storage, uploads } = fakeStorage();
  const path = await storeEpisodeAudio(episodeAudioPath('user-1', 'run-1'), Buffer.from('mp3'), storage);
  assert.equal(path, 'podcasts/user-1/run-1.mp3');
  assert.deepEqual(uploads, [{ path: 'podcasts/user-1/run-1.mp3', bytes: 3, contentType: 'audio/mpeg' }]);
  assert.doesNotMatch(path!, /^https?:/);
  // The public URL old apps read is a fixed string built from the path, with no storage call.
  assert.equal(legacyPublicAudioUrl(path!), `${PUBLIC_PREFIX}podcasts/user-1/run-1.mp3`);
  assert.equal(audioPathFromPublicUrl(legacyPublicAudioUrl(path!)), path, 'the two directions agree');
});

test('a refused upload leaves the episode without audio rather than failing it', async () => {
  const storage = { upload: async () => ({ data: null, error: { message: 'bucket not found' } }), createSignedUrl: async () => ({ data: null, error: null }) } as unknown as AudioStorage;
  assert.equal(await storeEpisodeAudio('podcasts/u/r.mp3', Buffer.from('x'), storage), null);
});

test('the path inside a public URL, and nothing from a URL that is not ours', () => {
  assert.equal(audioPathFromPublicUrl(`${PUBLIC_PREFIX}podcasts/u1/r1.mp3`), 'podcasts/u1/r1.mp3');
  assert.equal(audioPathFromPublicUrl(`${PUBLIC_PREFIX}podcasts/u1/r1.mp3?download=1`), 'podcasts/u1/r1.mp3');
  assert.equal(audioPathFromPublicUrl('https://other.example/podcasts/u1/r1.mp3'), null);
  assert.equal(audioPathFromPublicUrl(null), null);
  assert.equal(audioPathOf({ audio_path: 'p/a.mp3', audio_url: `${PUBLIC_PREFIX}p/b.mp3` }), 'p/a.mp3', 'the stored path wins');
  assert.equal(audioPathOf({ audio_path: null, audio_url: `${PUBLIC_PREFIX}p/b.mp3` }), 'p/b.mp3', 'an old row is derived');
  assert.equal(audioPathOf({ audio_path: null, audio_url: null }), null);
});

test('signed links expire', async () => {
  const { storage, signed } = fakeStorage();
  const link = await signedAudioUrl('podcasts/u1/r1.mp3', undefined, { storage, now: NOW });
  assert.ok(link);
  assert.deepEqual(signed, [{ path: 'podcasts/u1/r1.mp3', ttl: SIGNED_AUDIO_TTL_SECONDS }], 'storage is asked for the default hour');
  assert.equal(link.expiresAt, new Date(NOW.getTime() + 3600_000).toISOString());
  assert.match(link.url, /\/object\/sign\/podcast-audio\/podcasts\/u1\/r1\.mp3\?token=/);
  assert.doesNotMatch(link.url, /\/object\/public\//, 'never the public form');
  const short = await signedAudioUrl('podcasts/u1/r1.mp3', 60, { storage, now: NOW });
  assert.equal(short!.expiresAt, new Date(NOW.getTime() + 60_000).toISOString());
  // No path, no link; a bad ttl is a programming error; a signing failure is null, not a throw.
  assert.equal(await signedAudioUrl(null, 60, { storage }), null);
  await assert.rejects(signedAudioUrl('p', 0, { storage }), RangeError);
  await assert.rejects(signedAudioUrl('p', 48 * 3600, { storage }), RangeError);
  assert.equal(await signedAudioUrl('p', 60, { storage: fakeStorage('object not found').storage }), null);
  // A thrown call (a failed fetch) is the same answer, never a throw.
  const throwing = { upload: async () => ({ error: null }), createSignedUrl: async () => { throw new Error('fetch failed'); }, createSignedUrls: async () => { throw new Error('fetch failed'); } } as unknown as AudioStorage;
  assert.equal(await signedAudioUrl('p', 60, { storage: throwing }), null);
  assert.deepEqual(await signedAudioUrls(['p', null], 60, { storage: throwing }), [null, null]);
});

test('many links are signed in one call, in order, with nulls for missing audio and refused paths', async () => {
  const asked: string[][] = [];
  const storage = { upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: null }),
    createSignedUrls: async (paths: string[], ttl: number) => { asked.push([...paths, String(ttl)]); return { data: paths.map((p) => (p.endsWith('bad.mp3') ? { path: p, signedUrl: null, error: 'Object not found' } : { path: p, signedUrl: `https://x/sign/${p}?token=t`, error: null })), error: null }; },
  } as unknown as AudioStorage;
  const links = await signedAudioUrls(['podcasts/u/a.mp3', null, 'podcasts/u/bad.mp3', 'podcasts/u/a.mp3'], 120, { storage, now: NOW });
  assert.deepEqual(asked, [['podcasts/u/a.mp3', 'podcasts/u/bad.mp3', '120']], 'one call, each path once');
  assert.deepEqual(links.map((l) => l?.url ?? null), ['https://x/sign/podcasts/u/a.mp3?token=t', null, null, 'https://x/sign/podcasts/u/a.mp3?token=t']);
  assert.equal(links[0]!.expiresAt, new Date(NOW.getTime() + 120_000).toISOString());
  assert.deepEqual(await signedAudioUrls([null, undefined], 60, { storage }), [null, null], 'nothing to sign, no call');
  assert.equal(asked.length, 1);
});

// ── The migration and the route, on a real database ─────────────────────────

let db: PGlite;
let server: Server;
let base = '';
const signed: string[] = [];
let signCalls = 0;
before(async () => {
  ({ db } = await freshDatabase({ through: '153_spend_ledger.sql' }));
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const app = express();
  app.use(express.json());
  app.use('/podcasts', makePodcastsRouter({
    signAudio: async (path) => { if (!path) return null; signed.push(path); return { url: `https://signed/${path}?token=x`, expiresAt: NOW.toISOString() }; },
    // One call per list: every path at once, nulls where there is no audio.
    signAudioMany: async (paths) => { signCalls++; return paths.map((path) => { if (!path) return null; signed.push(path); return { url: `https://signed/${path}?token=x`, expiresAt: NOW.toISOString() }; }); },
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const episode = async (userId: string, audio_url: string | null) => (await db.query<{ id: string }>(
  `INSERT INTO podcast_episodes (user_id, title, script, status, audio_url) VALUES ($1, 'Ep', 'Script.', 'ready', $2) RETURNING id`, [userId, audio_url])).rows[0]!.id;

test('the backfill derives the right path', async () => {
  const userId = await insertUser(db);
  const ours = await episode(userId, `${PUBLIC_PREFIX}podcasts/${userId}/run-9.mp3`);
  const withQuery = await episode(userId, `${PUBLIC_PREFIX}podcasts/${userId}/run-8.mp3?download=1`);
  const foreign = await episode(userId, 'https://cdn.example/old/audio.mp3');
  const none = await episode(userId, null);
  await db.exec(readFileSync(join(__dirname, '..', 'supabase', 'migrations', '154_podcast_audio_paths.sql'), 'utf8'));
  const rows = (await db.query<{ id: string; audio_path: string | null; audio_url: string | null }>(`SELECT id, audio_path, audio_url FROM podcast_episodes WHERE user_id = $1`, [userId])).rows;
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by[ours]!.audio_path, `podcasts/${userId}/run-9.mp3`);
  assert.equal(by[withQuery]!.audio_path, `podcasts/${userId}/run-8.mp3`);
  assert.equal(by[foreign]!.audio_path, null);
  assert.equal(by[none]!.audio_path, null);
  assert.equal(by[ours]!.audio_url, `${PUBLIC_PREFIX}podcasts/${userId}/run-9.mp3`, 'audio_url is kept for old app versions');
  // Re-runnable, and a new row with a path is left alone.
  await db.exec(readFileSync(join(__dirname, '..', 'supabase', 'migrations', '154_podcast_audio_paths.sql'), 'utf8'));
  assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int n FROM podcast_episodes WHERE user_id = $1 AND audio_path IS NOT NULL`, [userId])).rows[0]!.n, 2);
});

test('the episodes route signs each audio link, only for the person asking', async () => {
  const alice = await insertUser(db), bob = await insertUser(db);
  await db.query(`INSERT INTO podcast_episodes (user_id, title, script, status, audio_path, audio_url) VALUES ($1, 'A', 's', 'ready', $2, $3)`, [alice, `podcasts/${alice}/a.mp3`, `${PUBLIC_PREFIX}podcasts/${alice}/a.mp3`]);
  await db.query(`INSERT INTO podcast_episodes (user_id, title, script, status) VALUES ($1, 'Quiet', 's', 'ready')`, [alice]);
  await db.query(`INSERT INTO podcast_episodes (user_id, title, script, status, audio_path) VALUES ($1, 'B', 's', 'ready', $2)`, [bob, `podcasts/${bob}/b.mp3`]);
  signed.length = 0;
  signCalls = 0;
  const res = await fetch(`${base}/podcasts/${alice}`);
  assert.equal(res.status, 200);
  assert.equal(signCalls, 1, 'the list is signed in one storage call');
  const { episodes } = (await res.json()) as { episodes: Array<{ title: string; audio: { url: string; expiresAt: string } | null; audio_url: string | null }> };
  assert.deepEqual(episodes.map((e) => e.title).sort(), ['A', 'Quiet']);
  const a = episodes.find((e) => e.title === 'A')!;
  assert.deepEqual(a.audio, { url: `https://signed/podcasts/${alice}/a.mp3?token=x`, expiresAt: NOW.toISOString() });
  assert.equal(episodes.find((e) => e.title === 'Quiet')!.audio, null);
  assert.deepEqual(signed, [`podcasts/${alice}/a.mp3`], "bob's audio was never signed for alice");
});
