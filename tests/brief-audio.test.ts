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
  briefPartsOf, briefWordsChanged, makeBriefAudio, measureSeconds, stripFrameMetadata, briefAudioPath, MAKING_STALE_MS, type BriefAudioStorage,
} from '../src/briefs/brief-audio';
import { runDailyBrief, saveBrief, speakSavedBrief } from '../src/briefs/run-daily-brief';
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

test('a re-made brief with different spoken words starts its audio over; the same words keep it, whatever the stored key order', () => {
  const stored = { text: 'x', why: null, quote: '', sourceRef: { raw_content_id: '' } };
  // The same item as jsonb hands it back: keys reordered.
  const readBack = { sourceRef: { raw_content_id: '' }, quote: '', why: null, text: 'x' };
  const v1 = { kind: 'brief' as const, through_line: 'a', spine_movement: 'complicates', items: [stored] };
  assert.equal(briefWordsChanged(null, v1), true);
  assert.equal(briefWordsChanged({ ...v1, items: [readBack] }, v1), false, 'jsonb key order is not a change');
  assert.equal(briefWordsChanged({ ...v1, items: [{ text: 'y' }] }, v1), true);
  assert.equal(briefWordsChanged({ ...v1, items: [] }, v1), true);
  // v1 speaks the items, not the through line; v2 speaks the through line, not the items.
  assert.equal(briefWordsChanged({ ...v1, through_line: 'b' }, v1), false);
  const v2 = { kind: 'brief' as const, through_line: 'one.\n\ntwo.', spine_movement: 'planner v2', items: [{ text: 'pattern' }] };
  assert.equal(briefWordsChanged({ ...v2, items: [{ text: 'answer' }] }, v2), false);
  assert.equal(briefWordsChanged({ ...v2, through_line: 'one.\n\nthree.' }, v2), true);
  assert.equal(briefWordsChanged({ ...v2, kind: 'quiet' }, v2), true);
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
  assert.equal(uploads[0]!.path, briefAudioPath(userId, id, NOW.toISOString()));
  assert.equal(uploads[0]!.contentType, 'audio/mpeg');
  assert.match(r.path, new RegExp(`^${userId}/${id}-\\d+\\.mp3$`), 'named by the synthesis that made it');
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
  // The voice billed both parts before the upload failed: charged, even though no audio came of it. Nothing for the silent one.
  const ledger = await db.query<{ n: number; usd: string }>(`SELECT count(*)::int n, coalesce(sum(usd), 0)::text usd FROM spend_ledger WHERE user_id = $1 AND kind = 'brief_audio'`, [userId]);
  assert.equal(ledger.rows[0]!.n, 1);
  assert.ok(Number(ledger.rows[0]!.usd) > 0);
  // A throwing upload is the same failure.
  const thrown = await brief(userId, { date: '2026-10-18' });
  const r3 = await makeBriefAudio(userId, thrown, { storage: { upload: async () => { throw new Error('socket hang up'); } }, tts: alternating() });
  assert.deepEqual(r3, { outcome: 'failed', reason: 'upload' });
  assert.equal((await rowOf(thrown)).audio_status, 'failed');
});

test('a part that fails to synthesise still charges the parts spoken before it', async () => {
  const userId = await insertUser(db);
  const id = await brief(userId);
  let n = 0;
  const r = await makeBriefAudio(userId, id, { storage: fakeStorage().storage, tts: async () => { if (n++ === 0) return SHORT; throw new Error('voice down'); } });
  assert.deepEqual(r, { outcome: 'failed', reason: 'synthesis' });
  const ledger = await db.query<{ n: number }>(`SELECT count(*)::int n FROM spend_ledger WHERE user_id = $1 AND kind = 'brief_audio'`, [userId]);
  assert.equal(ledger.rows[0]!.n, 1, 'the first part was spoken, so it was paid for');
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
  const same = { kind: 'brief' as const, through_line: 'the through line.', spine_question_id: null, spine_movement: 'complicates', items: JSON.parse((await db.query<{ items: string }>(`SELECT items::text FROM daily_briefs WHERE id = $1`, [id])).rows[0]!.items), dropped: 0, model_version: null, cost_usd: 0 };
  assert.equal(await saveBrief(supabase, userId, '2026-10-20', same), id, 'the same row');
  assert.equal((await rowOf(id)).audio_status, 'ready', 'the same words keep their audio');
  // A v1 brief speaks its items: a new through line alone is not a change; a changed item is.
  assert.equal(await saveBrief(supabase, userId, '2026-10-20', { ...same, through_line: 'different line.' }), id);
  assert.equal((await rowOf(id)).audio_status, 'ready');
  assert.equal(await saveBrief(supabase, userId, '2026-10-20', { ...same, items: [{ ...same.items[0], text: 'different words.' }, same.items[1]] }), id);
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

test('two runs at once: one speaks, the other is already_making; a claim older than the grace is taken over', async () => {
  const userId = await insertUser(db);
  const id = await brief(userId, { date: '2026-10-17' });
  let spoken = 0;
  const slow = async () => { spoken++; await new Promise((r) => setTimeout(r, 30)); return SHORT; };
  const [a, b] = await Promise.all([
    makeBriefAudio(userId, id, { storage: fakeStorage().storage, tts: slow }),
    makeBriefAudio(userId, id, { storage: fakeStorage().storage, tts: slow }),
  ]);
  assert.deepEqual([a.outcome, b.outcome].sort(), ['already_making', 'ready']);
  assert.equal(spoken, 2, 'the two parts were spoken once each, by one run');
  const ledger = await db.query<{ n: number }>(`SELECT count(*)::int n FROM spend_ledger WHERE user_id = $1 AND kind = 'brief_audio'`, [userId]);
  assert.equal(ledger.rows[0]!.n, 1);
  // A run that died mid-way leaves `making`; within the grace nobody else may start, after it they may.
  const crashed = await brief(userId, { date: '2026-10-16' });
  await db.query(`UPDATE daily_briefs SET audio_status = 'making', audio_updated_at = $2 WHERE id = $1`, [crashed, new Date(NOW.getTime() - MAKING_STALE_MS + 60_000).toISOString()]);
  assert.deepEqual(await makeBriefAudio(userId, crashed, { storage: fakeStorage().storage, tts: alternating(), now: () => NOW }), { outcome: 'already_making' });
  const later = new Date(NOW.getTime() + 2 * 60_000);
  assert.equal((await makeBriefAudio(userId, crashed, { storage: fakeStorage().storage, tts: alternating(), now: () => later })).outcome, 'ready');
});

test('a billing failure never leaves a ready brief, and a failed ready write charges once', async () => {
  const userId = await insertUser(db);
  const unbilled = await brief(userId, { date: '2026-10-15' });
  const r1 = await makeBriefAudio(userId, unbilled, { storage: fakeStorage().storage, tts: alternating(), recordSpend: async () => 0 });
  assert.deepEqual(r1, { outcome: 'failed', reason: 'billing' });
  assert.equal((await rowOf(unbilled)).audio_status, 'failed');
  // The ready write refused: failed, and the characters are in the ledger exactly once.
  const refused = await brief(userId, { date: '2026-10-14' });
  const real = supabase;
  const db2 = new Proxy(real, { get(target, prop) {
    if (prop !== 'from') return Reflect.get(target, prop);
    return (table: string) => {
      const q = real.from(table);
      const update = q.update.bind(q);
      return Object.assign(q, { update: (values: Record<string, unknown>) => (values.audio_status === 'ready' ? { eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: 'write refused' } }) }) }) }) }) } : update(values)) });
    };
  } }) as typeof supabase;
  const r2 = await makeBriefAudio(userId, refused, { db: db2, storage: fakeStorage().storage, tts: alternating() });
  assert.deepEqual(r2, { outcome: 'failed', reason: 'save' });
  const ledger = await db.query<{ n: number }>(`SELECT count(*)::int n FROM spend_ledger WHERE user_id = $1 AND kind = 'brief_audio'`, [userId]);
  assert.equal(ledger.rows[0]!.n, 1, 'charged once for the refused write, nothing for the unbilled one');
});

test('a brief re-made while its audio is being spoken keeps the newer words: the older synthesis is superseded', async () => {
  const userId = await insertUser(db);
  const id = await brief(userId, { date: '2026-10-13' });
  const items = JSON.parse((await db.query<{ items: string }>(`SELECT items::text FROM daily_briefs WHERE id = $1`, [id])).rows[0]!.items);
  let n = 0;
  const tts = async () => {
    if (n++ === 1) {
      // New words arrive while the second part is being spoken.
      await saveBrief(supabase, userId, '2026-10-13', { kind: 'brief', through_line: 'the through line.', spine_question_id: null, spine_movement: 'complicates', items: [{ ...items[0], text: 'new words.' }, items[1]], dropped: 0, model_version: null, cost_usd: 0 });
    }
    return SHORT;
  };
  const { storage, uploads } = fakeStorage();
  const r = await makeBriefAudio(userId, id, { storage, tts });
  assert.deepEqual(r, { outcome: 'superseded' });
  assert.equal(uploads.length, 1, 'the old words were uploaded under their own revision, which nothing points at');
  const row = await rowOf(id);
  assert.equal(row.audio_status, 'none', 'the reset by the re-make stands');
  assert.equal(row.audio_path, null);
});

test('an audio exception never fails a saved brief run: the audio is failed, the brief is returned', async () => {
  const userId = await insertUser(db);
  const id = await brief(userId, { date: '2026-10-12' });
  await db.query(`UPDATE daily_briefs SET audio_status = 'making', audio_updated_at = now() WHERE id = $1`, [id]);
  const r = await speakSavedBrief(async () => { throw new Error('boom'); }, supabase, userId, id);
  assert.deepEqual(r, { outcome: 'failed', reason: 'exception' });
  assert.equal((await rowOf(id)).audio_status, 'failed');
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
