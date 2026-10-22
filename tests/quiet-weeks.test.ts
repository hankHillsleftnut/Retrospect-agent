/**
 * BEA.8: quiet weeks are a state, not an error. The planner path ends in one
 * of three outcomes; the route answers 200 for all of them. The reads, the
 * writer, the summary, the embedding and the voice are injected; the database
 * (PGlite) and the trace are real.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { runPodcastV2, type PodcastV2Deps } from '../src/pipelines/podcast-v2';
import type { PodcastResult } from '../src/pipelines/podcast';
import type { UnderstandingContract } from '../src/understanding/read';
import { makePodcastsRouter } from '../src/routes/podcasts';

const u = { inputTokens: 1, outputTokens: 1 };
const emptyContract = (userId: string): UnderstandingContract => ({
  userId, asOf: '2026-10-22', answers: [], silent: [], patterns: [], whys: [], goals: [], shifts: [],
  time: { categories: [], otherShare: 0, weeksOfBaseline: 0 }, moves: { since: null, items: [] },
});
const livelyContract = (userId: string): UnderstandingContract => ({
  ...emptyContract(userId),
  patterns: [{ kind: 'pattern', id: 'p1', label: 'skips the saturday run after a late friday', confidence: 0.9, instances: 5, firstSeenAt: '2026-09-01', lastSeenAt: '2026-10-20', trajectory: null, trajectoryDetail: null, register: 'stated' }],
});

/** Deps that fail loudly where a quiet run must never reach. */
function deps(contract: (userId: string) => UnderstandingContract, overrides: Partial<PodcastV2Deps> = {}): PodcastV2Deps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    gather: async (userId) => { calls.push('gather'); return { contract: contract(userId), saidVsDid: { goals: [], usage: u }, content: { groups: [], usage: u } }; },
    hypotheses: async () => { calls.push('hypotheses'); return null; },
    write: async (plan) => {
      calls.push('write');
      return { title: 'The late friday', sections: plan.items.map((i) => ({ id: i.id, register: i.register, kept: ['You skip the run after a late Friday.'], cut: [] })), stats: { sentences: 1, kept: 1, cut: 0, sectionsWithEvidence: 1, sections: 1, words: 8 }, usage: { writer: u, guard: u } };
    },
    summarise: async () => { calls.push('summarise'); return { text: 'A short week.', usage: { promptTokens: 1, completionTokens: 1 } }; },
    embed: async () => { calls.push('embed'); return new Array(3072).fill(0); },
    tts: async () => { calls.push('tts'); return Buffer.alloc(0); },
    ...overrides,
  };
}

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});
const traceOf = async (id: string) => (await db.query<{ status: string; episode_id: string | null }>(`SELECT status, episode_id FROM pipeline_run_traces WHERE id = $1`, [id])).rows[0]!;
const episodesOf = async (userId: string) => (await db.query<{ n: number }>(`SELECT count(*)::int n FROM podcast_episodes WHERE user_id = $1`, [userId])).rows[0]!.n;

test('a quiet week completes with outcome quiet_week: no writer, no episode, no audio, the trace completed', async () => {
  const userId = await insertUser(db);
  const d = deps(emptyContract);
  const r = await runPodcastV2({ userId, skipTTS: true }, d);
  assert.equal(r.outcome, 'quiet_week');
  assert.equal(r.episodeId, null);
  assert.equal(r.audioPath, null);
  assert.equal(r.script, '');
  assert.deepEqual(r.v2?.plan.items, []);
  assert.deepEqual(r.v2?.guard, { sentences: 0, kept: 0, cut: 0 });
  assert.deepEqual(d.calls, ['gather', 'hypotheses'], 'nothing past the plan was called');
  assert.equal(await episodesOf(userId), 0);
  assert.deepEqual(await traceOf(r.traceId!), { status: 'completed', episode_id: null }, 'a state, not a failed run');
});

test('a fully cut script is nothing_safe_to_say, with the plan and the guard numbers', async () => {
  const userId = await insertUser(db);
  const d = deps(livelyContract, {
    write: async (plan) => ({ title: 'x', sections: plan.items.map((i) => ({ id: i.id, register: i.register, kept: [], cut: [{ sentence: 'You never run.', reason: 'not supported' }] })), stats: { sentences: 1, kept: 0, cut: 1, sectionsWithEvidence: 1, sections: 1, words: 0 }, usage: { writer: u, guard: u } }),
  });
  const r = await runPodcastV2({ userId, skipTTS: true }, d);
  assert.equal(r.outcome, 'nothing_safe_to_say');
  assert.equal(r.episodeId, null);
  assert.equal(r.v2?.plan.items.length, 1, 'the plan is returned so the caller can see what was tried');
  assert.deepEqual(r.v2?.guard, { sentences: 1, kept: 0, cut: 1 });
  assert.deepEqual(d.calls.filter((c) => c !== 'write'), ['gather', 'hypotheses'], 'no summary, no embedding, no voice');
  assert.equal(await episodesOf(userId), 0);
  assert.equal((await traceOf(r.traceId!)).status, 'completed');
});

test('a made episode still returns its id and plan', async () => {
  const userId = await insertUser(db);
  const d = deps(livelyContract);
  const r = await runPodcastV2({ userId, skipTTS: true }, d);
  assert.equal(r.outcome, 'made');
  assert.ok(r.episodeId, 'an episode row');
  assert.equal(r.title, 'The late friday');
  assert.equal(r.v2?.plan.items.length, 1);
  assert.deepEqual(r.v2?.guard, { sentences: 1, kept: 1, cut: 0 });
  assert.deepEqual(d.calls, ['gather', 'hypotheses', 'write', 'summarise', 'embed']);
  assert.equal(await episodesOf(userId), 1);
  assert.deepEqual(await traceOf(r.traceId!), { status: 'completed', episode_id: r.episodeId });
});

test('a real failure is still a failed run', async () => {
  const userId = await insertUser(db);
  const d = deps(livelyContract, { write: async () => { throw new Error('writer down'); } });
  await assert.rejects(runPodcastV2({ userId, skipTTS: true }, d), /writer down/);
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM pipeline_run_traces WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1`, [userId]);
  assert.equal(rows[0]!.status, 'failed');
});

// ── The route ────────────────────────────────────────────────────────────────

let server: Server;
let base = '';
let next: PodcastResult;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/podcasts', makePodcastsRouter({ runPodcast: async () => next, signAudio: async (path) => (path ? { url: `https://signed/${path}`, expiresAt: '2026-10-22T13:00:00.000Z' } : null), signAudioMany: async (paths) => paths.map(() => null) }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));
const generate = async (userId: string) => {
  const res = await fetch(`${base}/podcasts/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, dryRun: true }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const base_: Omit<PodcastResult, 'outcome'> = { traceId: 't1', episodeId: null, script: '', audioPath: null, audioUrl: null, summary: '', title: '', description: '', mood: 'reflective', durationSeconds: 0, cost: [] };
const plan = { items: [], withheld: [], reflection: null, hypothesis: null } as unknown as NonNullable<PodcastResult['v2']>['plan'];

test('a quiet week is a 200 with outcome quiet_week and no episode', async () => {
  next = { ...base_, outcome: 'quiet_week', v2: { plan, guard: { sentences: 0, kept: 0, cut: 0 } } };
  const res = await generate('u');
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'quiet_week');
  assert.equal(res.body.episodeId, null);
  assert.deepEqual(res.body.guard, { sentences: 0, kept: 0, cut: 0 });
  assert.deepEqual(res.body.plan, plan);
  assert.equal('audioUrl' in res.body, false);
});

test('a fully cut script is a 200 with outcome nothing_safe_to_say', async () => {
  next = { ...base_, outcome: 'nothing_safe_to_say', v2: { plan, guard: { sentences: 4, kept: 0, cut: 4 } } };
  const res = await generate('u');
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'nothing_safe_to_say');
  assert.deepEqual(res.body.guard, { sentences: 4, kept: 0, cut: 4 });
});

test('a made episode answers its id, its plan and the guard, with the signed audio', async () => {
  next = { ...base_, outcome: 'made', episodeId: 'e1', title: 'T', script: 's', audioPath: 'podcasts/u/t1.mp3', audioUrl: 'https://public/x.mp3', v2: { plan, guard: { sentences: 4, kept: 3, cut: 1 } } };
  const res = await generate('u');
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'made');
  assert.equal(res.body.episodeId, 'e1');
  assert.deepEqual(res.body.plan, plan);
  assert.deepEqual(res.body.guard, { sentences: 4, kept: 3, cut: 1 });
  assert.deepEqual(res.body.audio, { url: 'https://signed/podcasts/u/t1.mp3', expiresAt: '2026-10-22T13:00:00.000Z' });
});
