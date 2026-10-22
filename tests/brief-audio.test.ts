/**
 * BE1.3b: briefs are audio. Parts are spoken one at a time, measured from the
 * MP3, joined, stored privately; `ready` only after the upload returned; a
 * quiet brief says nothing; a re-made brief starts its audio over. The voice
 * and the bucket are faked (they are ElevenLabs' and Supabase's); the MP3
 * measuring is real, on two tiny silent files; the database is real (PGlite).
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
import {
  briefPartsOf, briefWordsChanged, makeBriefAudio, measureSeconds, stripFrameMetadata, briefAudioPath, type BriefAudioStorage,
} from '../src/briefs/brief-audio';
import { runDailyBrief, saveBrief } from '../src/briefs/run-daily-brief';
import { quietBrief } from '../src/briefs/daily-brief';
import { makeBriefsRouter } from '../src/routes/briefs';
import { checkDailySpend } from '../src/pipelines/spend-guard';

const AUDIO = join(__dirname, 'fixtures', 'audio');
const SHORT = readFileSync(join(AUDIO, 'silence-500ms.mp3'));   // ~0.57 s as encoded
const LONG = readFileSync(join(AUDIO, 'silence-1250ms.mp3'));   // ~1.31 s as encoded
const NOW = new Date('2026-10-22T08:00:00Z');
const near = (a: number, b: number, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

// ── Pure parts ───────────────────────────────────────────────────────────────

test('the spoken parts: one per v1 item, v2 split at blank lines, nothing on a quiet day', () => {
  assert.deepEqual(briefPartsOf({ kind: 'brief', spine_movement: 'complicates', through_line: 'x', items: [{ text: 'one.' }, { text: ' two. ' }, { text: '' }] }), ['one.', 'two.']);
  assert.deepEqual(briefPartsOf({ kind: 'brief', spine_movement: 'planner v2', through_line: 'first para.\n\nsecond para.\n \nthird.', items: [{ text: 'pattern' }] }), ['first para.', 'second para.', 'third.']);
  assert.deepEqual(briefPartsOf({ kind: 'quiet', spine_movement: null, through_line: 'nothing new.', items: [] }), []);
});

test('the quiet lines are lowercase at the source', () => {
  assert.equal(quietBrief().throughLine, "nothing new since your last brief. i'll keep listening.");
});

test('the MP3 fixtures measure as encoded, and stripped parts joined measure as their sum', async () => {
  near(await measureSeconds(SHORT), 0.57);
  near(await measureSeconds(LONG), 1.31);
  // Unstripped, the first file's Info frame claims the whole length: a player would stop at 0.57 s.
  near(await measureSeconds(Buffer.concat([SHORT, LONG])), 0.57);
  const joined = Buffer.concat([stripFrameMetadata(SHORT), stripFrameMetadata(LONG)]);
  assert.ok(joined.length < SHORT.length + LONG.length, 'the tag and the Info frame were dropped');
  near(await measureSeconds(joined), 0.57 + 1.31, 0.08);
  await assert.rejects(measureSeconds(Buffer.from('not audio')), /no measurable length/);
});

test('a re-made brief with different words starts its audio over; the same words keep it', () => {
  const row = { through_line: 'a', items: [{ text: 'x' }] };
  assert.equal(briefWordsChanged(null, row), true);
  assert.equal(briefWordsChanged({ through_line: 'a', items: [{ text: 'x' }] }, row), false);
  assert.equal(briefWordsChanged({ through_line: 'b', items: [{ text: 'x' }] }, row), true);
  assert.equal(briefWordsChanged({ through_line: 'a', items: [] }, row), true);
});

// ── On the database ──────────────────────────────────────────────────────────

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

async function brief(userId: string, opts: { kind?: 'brief' | 'quiet'; items?: unknown[]; through?: string; date?: string; v2?: boolean } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO daily_briefs (user_id, brief_date, kind, through_line, spine_movement, items) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, opts.date ?? '2026-10-22', opts.kind ?? 'brief', opts.through ?? 'the through line.', opts.v2 ? 'planner v2' : 'complicates',
      JSON.stringify(opts.items ?? [{ text: 'you slept short.', why: null, quote: '', sourceRef: { raw_content_id: '' } }, { text: 'the call is at ten.', why: 'for your goal', quote: '', sourceRef: { raw_content_id: '' } }])],
  );
  return rows[0]!.id;
}
const rowOf = async (id: string) => (await db.query<{ audio_status: string; audio_path: string | null; audio_parts: unknown; audio_duration_seconds: string | null; audio_chars: number | null }>(
  `SELECT audio_status, audio_path, audio_parts, audio_duration_seconds, audio_chars FROM daily_briefs WHERE id = $1`, [id])).rows[0]!;

function fakeStorage(onUpload?: (path: string) => Promise<void>, error: string | null = null) {
  const uploads: Array<{ path: string; bytes: number; contentType: string }> = [];
  const storage: BriefAudioStorage = {
    upload: async (path, body, options) => {
      await onUpload?.(path);
      uploads.push({ path, bytes: body.length, contentType: options.contentType });
      return { error: error ? { message: error } : null };
    },
  };
  return { storage, uploads };
}
const alternating = () => { let n = 0; return async () => (n++ % 2 === 0 ? SHORT : LONG); };

test('a brief is spoken part by part, measured, joined, stored privately, and ready only after the upload returns', async () => {
  const userId = await insertUser(db);
  const id = await brief(userId);
  let statusAtUpload = '';
  const { storage, uploads } = fakeStorage(async () => { statusAtUpload = (await rowOf(id)).audio_status; });
  const spoken: string[] = [];
  const tts = alternating();
  const r = await makeBriefAudio(userId, id, { storage, tts: async (text, persona) => { spoken.push(`${persona}:${text}`); return tts(); }, now: () => NOW });
  assert.equal(r.outcome, 'ready');
  if (r.outcome !== 'ready') return;
  assert.deepEqual(spoken, ['thoughtful_friend:you slept short.', 'thoughtful_friend:the call is at ten.'], 'one call per part, with the persona');
  assert.equal(statusAtUpload, 'making', 'while the file was going up the row said making');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0]!.path, briefAudioPath(userId, id));
  assert.equal(uploads[0]!.contentType, 'audio/mpeg');
  assert.equal(r.path, `${userId}/${id}.mp3`);
  assert.equal(r.parts.length, 2);
  assert.deepEqual(r.parts.map((p) => p.index), [0, 1]);
  assert.equal(r.parts[0]!.startSeconds, 0);
  near(r.parts[1]!.startSeconds, 0.57);
  near(r.durationSeconds, 1.88, 0.08);
  assert.equal(r.chars, 'you slept short.'.length + 'the call is at ten.'.length);
  const row = await rowOf(id);
  assert.equal(row.audio_status, 'ready');
  assert.equal(row.audio_path, r.path);
  assert.deepEqual((row.audio_parts as Array<{ text: string }>).map((p) => p.text), ['you slept short.', 'the call is at ten.'], 'audio_parts hold what was spoken');
  near(Number(row.audio_duration_seconds), r.durationSeconds, 0.01);
  assert.equal(row.audio_chars, r.chars);
  // The voice was paid for: one ledger line, by characters.
  const ledger = await db.query<{ kind: string; usd: string }>(`SELECT kind, usd::text FROM spend_ledger WHERE user_id = $1`, [userId]);
  assert.deepEqual(ledger.rows.map((l) => l.kind), ['brief_audio']);
  assert.ok(Number(ledger.rows[0]!.usd) > 0);
});

test('a quiet brief makes no audio', async () => {
  const userId = await insertUser(db);
  const id = await brief(userId, { kind: 'quiet', items: [] });
  const { storage, uploads } = fakeStorage();
  const r = await makeBriefAudio(userId, id, { storage, tts: async () => { throw new Error('must not speak'); } });
  assert.deepEqual(r, { outcome: 'quiet' });
  assert.deepEqual(uploads, []);
  assert.equal((await rowOf(id)).audio_status, 'none');
});

test('a brief already ready is left alone', async () => {
  const userId = await insertUser(db);
  const id = await brief(userId);
  await db.query(`UPDATE daily_briefs SET audio_status = 'ready', audio_path = 'p' WHERE id = $1`, [id]);
  const r = await makeBriefAudio(userId, id, { storage: fakeStorage().storage, tts: async () => { throw new Error('must not speak'); } });
  assert.deepEqual(r, { outcome: 'already_ready' });
});

test('no voice configured, or a failed upload, leaves a failed status and a brief that still reads', async () => {
  const userId = await insertUser(db);
  const silent = await brief(userId);
  const r1 = await makeBriefAudio(userId, silent, { storage: fakeStorage().storage, tts: async () => Buffer.alloc(0) });
  assert.deepEqual(r1, { outcome: 'failed', reason: 'no_voice' });
  assert.equal((await rowOf(silent)).audio_status, 'failed');
  assert.equal((await rowOf(silent)).audio_path, null);

  const refused = await brief(userId, { date: '2026-10-21' });
  const r2 = await makeBriefAudio(userId, refused, { storage: fakeStorage(undefined, 'bucket not found').storage, tts: alternating() });
  assert.deepEqual(r2, { outcome: 'failed', reason: 'upload' });
  assert.equal((await rowOf(refused)).audio_status, 'failed');
  const words = await db.query<{ through_line: string }>(`SELECT through_line FROM daily_briefs WHERE id = $1`, [refused]);
  assert.equal(words.rows[0]!.through_line, 'the through line.', 'the text brief is untouched');
  // No voice was paid for.
  const ledger = await db.query<{ n: number }>(`SELECT count(*)::int n FROM spend_ledger WHERE user_id = $1`, [userId]);
  assert.equal(ledger.rows[0]!.n, 0);
});

test("another person's brief is not found, and nothing is spoken", async () => {
  const alice = await insertUser(db), bob = await insertUser(db);
  const id = await brief(bob);
  const r = await makeBriefAudio(alice, id, { storage: fakeStorage().storage, tts: async () => { throw new Error('must not speak'); } });
  assert.deepEqual(r, { outcome: 'not_found' });
  assert.equal((await rowOf(id)).audio_status, 'none');
});

test('a re-made brief resets its audio when the words change, and keeps it when they do not', async () => {
  const userId = await insertUser(db);
  const id = await brief(userId, { date: '2026-10-20' });
  await makeBriefAudio(userId, id, { storage: fakeStorage().storage, tts: alternating() });
  assert.equal((await rowOf(id)).audio_status, 'ready');
  const same = { kind: 'brief', through_line: 'the through line.', spine_question_id: null, spine_movement: 'complicates', items: JSON.parse((await db.query<{ items: string }>(`SELECT items::text FROM daily_briefs WHERE id = $1`, [id])).rows[0]!.items), dropped: 0, model_version: null, cost_usd: 0 };
  assert.equal(await saveBrief(supabase, userId, '2026-10-20', same), id, 'the same row');
  assert.equal((await rowOf(id)).audio_status, 'ready', 'the same words keep their audio');
  assert.equal(await saveBrief(supabase, userId, '2026-10-20', { ...same, through_line: 'different words.' }), id);
  const reset = await rowOf(id);
  assert.equal(reset.audio_status, 'none');
  assert.equal(reset.audio_path, null);
  assert.deepEqual(reset.audio_parts, []);
  assert.equal(reset.audio_duration_seconds, null);
});

test('the brief engine speaks a saved brief and not a quiet one, never on a dry run', async () => {
  const userId = await insertUser(db);
  const made: string[] = [];
  const makeAudio = (async (_u: string, briefId: string) => { made.push(briefId); return { outcome: 'ready', path: 'p', durationSeconds: 1, parts: [], chars: 1 } as const; }) as never;
  const quiet = await runDailyBrief(userId, { now: NOW, makeAudio, model: async () => { throw new Error('nothing new: no model'); } });
  assert.equal(quiet.brief.kind, 'quiet');
  assert.equal(quiet.audio, null);
  assert.deepEqual(made, [], 'a quiet day is not spoken');

  await db.query(`INSERT INTO raw_content (user_id, content_type, content, created_at) VALUES ($1, 'journal_entry', 'test entry', $2)`, [userId, new Date(NOW.getTime() - 3600_000).toISOString()]);
  const reply = { spine_question_id: null, spine_movement: 'complicates', through_line: 'x', items: [{ text: 'you wrote a test entry.', why: 'y', source: 'M1', quote: 'test entry' }] };
  const dry = await runDailyBrief(userId, { now: NOW, makeAudio, dryRun: true, model: async () => ({ data: reply, usage: { inputTokens: 1, outputTokens: 1 } }) });
  assert.equal(dry.saved, false);
  assert.deepEqual(made, [], 'a dry run saves nothing, so it speaks nothing');
  const real = await runDailyBrief(userId, { now: NOW, makeAudio, model: async () => ({ data: reply, usage: { inputTokens: 1, outputTokens: 1 } }) });
  assert.equal(real.brief.kind, 'brief');
  assert.equal(real.saved, true);
  assert.deepEqual(made, [real.briefId]);
  assert.equal(real.audio?.outcome, 'ready');
});

// ── The internal route ───────────────────────────────────────────────────────

let server: Server;
let base = '';
const spoke: string[] = [];
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/briefs', makeBriefsRouter({
    checkSpend: (userId) => checkDailySpend(userId, { capUsd: 15, now: NOW }),
    makeBriefAudio: (userId, briefId) => makeBriefAudio(userId, briefId, { storage: fakeStorage().storage, tts: async (text) => { spoke.push(text); return SHORT; } }),
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));
const post = async (path: string) => { const res = await fetch(`${base}${path}`, { method: 'POST' }); return { status: res.status, body: (await res.json()) as Record<string, unknown> }; };

test('POST /briefs/:userId/:briefId/audio makes the audio once, only for its owner', async () => {
  const alice = await insertUser(db), bob = await insertUser(db);
  const id = await brief(alice, { date: '2026-10-19' });
  spoke.length = 0;
  assert.equal((await post(`/briefs/${bob}/${id}/audio`)).status, 404, "bob can't make alice's");
  assert.deepEqual(spoke, []);
  const first = await post(`/briefs/${alice}/${id}/audio`);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.outcome, 'ready');
  assert.equal(spoke.length, 2);
  const again = await post(`/briefs/${alice}/${id}/audio`);
  assert.deepEqual(again.body, { outcome: 'already_ready' });
  assert.equal(spoke.length, 2, 'spoken once');
  assert.equal((await post(`/briefs/${alice}/not-an-id/audio`)).status, 400);
});
