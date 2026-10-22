/**
 * BE1.4 (brain side): the open guesses for the journal. Listing is not
 * offering: nothing is marked offered; `stored` rows are reported as `offered`;
 * only rows whose evidence is still believed are listed; the dial off means
 * none; only the person's own. Real database (PGlite); the contract injected.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { makeHypothesesRouter } from '../src/routes/hypotheses';
import type { UnderstandingContract } from '../src/understanding/read';

const contractFor = (userId: string) => ({
  userId, asOf: '2026-10-22', silent: [], goals: [], shifts: [], whys: [], time: { categories: [], otherShare: 0, weeksOfBaseline: 0 }, moves: { since: null, items: [] },
  answers: [{ kind: 'answer', id: 'a1', questionId: 6, question: 'What pulls them?', domainId: 'want', answer: 'Making furniture', confidence: 0.8, sources: 3, confirmed: false, register: 'stated', lastMovedAt: null }],
  patterns: [{ kind: 'pattern', id: 'p1', label: 'Loses track of time in the workshop', confidence: 0.8, instances: 4, firstSeenAt: null, lastSeenAt: null, trajectory: null, trajectoryDetail: null, register: 'stated' }],
}) as unknown as UnderstandingContract;

let db: PGlite;
let server: Server;
let base = '';
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const app = express();
  app.use(express.json());
  app.use('/hypotheses', makeHypothesesRouter({ readUnderstanding: async (userId) => contractFor(userId) }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const get = async (path: string) => { const res = await fetch(`${base}${path}`); return { status: res.status, body: (await res.json()) as Record<string, unknown> }; };
const post = async (path: string, body: unknown) => { const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: (await res.json()) as Record<string, unknown> }; };
const speak = (on: boolean) => db.query(`UPDATE product_dials SET value = jsonb_set(value, '{speak}', $1::jsonb) WHERE key = 'hypotheses'`, [String(on)]);
async function guess(userId: string, over: { status?: string; supports?: unknown[]; question?: string; created?: string; offered?: number; framework?: string } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO hypotheses (user_id, framework, question, rationale, supports, status, offered_count, created_at) VALUES ($1, $2, $3, 'four hours gone', $4, $5, $6, $7) RETURNING id`,
    [userId, over.framework ?? 'flow', over.question ?? 'Is the workshop where you are most absorbed?', JSON.stringify(over.supports ?? [{ kind: 'pattern', id: 'p1' }, { kind: 'answer', id: 'a1' }]), over.status ?? 'stored', over.offered ?? 0, over.created ?? '2026-10-20T12:00:00Z'],
  );
  return rows[0]!.id;
}
const rowOf = async (id: string) => (await db.query<{ status: string; offered_count: number; last_offered_at: string | null }>(`SELECT status, offered_count, last_offered_at FROM hypotheses WHERE id = $1`, [id])).rows[0]!;
type Guess = { id: string; status: string; question: string; framework: { name: string; source?: string; wonders?: string }; restsOn: Array<{ kind: string; id: string; text: string }>; createdAt: string };

test('pending is empty while the dial is off', async () => {
  const userId = await insertUser(db);
  await guess(userId);
  await speak(false);
  assert.deepEqual((await get(`/hypotheses/${userId}/pending`)).body, { speaking: false, guesses: [] });
});

test('pending lists stored rows as offered and never marks them offered', async () => {
  const userId = await insertUser(db);
  const stored = await guess(userId, { created: '2026-10-19T12:00:00Z' });
  const offered = await guess(userId, { status: 'offered', offered: 1, created: '2026-10-21T12:00:00Z', question: 'Second?' });
  await guess(userId, { status: 'declined', created: '2026-10-22T12:00:00Z' });
  await guess(userId, { status: 'confirmed', created: '2026-10-22T13:00:00Z' });
  await guess(userId, { status: 'expired', created: '2026-10-22T14:00:00Z' });
  await speak(true);
  const res = await get(`/hypotheses/${userId}/pending`);
  assert.equal(res.status, 200);
  assert.equal(res.body.speaking, true);
  const guesses = res.body.guesses as Guess[];
  assert.deepEqual(guesses.map((g) => g.id), [offered, stored], 'open ones only, newest first');
  assert.deepEqual(guesses.map((g) => g.status), ['offered', 'offered'], 'stored is reported as offered: listing is the offer');
  assert.deepEqual(await rowOf(stored), { status: 'stored', offered_count: 0, last_offered_at: null }, 'nothing was marked offered');
  assert.deepEqual(await rowOf(offered), { status: 'offered', offered_count: 1, last_offered_at: null });
  // Listed many times, still never counted as an offer.
  await get(`/hypotheses/${userId}/pending`);
  assert.equal((await rowOf(stored)).offered_count, 0);
});

test('restsOn carries readable text for every kind, and a guess whose evidence is no longer believed waits', async () => {
  const userId = await insertUser(db);
  const believed = await guess(userId);
  await guess(userId, { supports: [{ kind: 'pattern', id: 'gone' }, { kind: 'answer', id: 'a1' }], created: '2026-10-21T12:00:00Z' });
  await speak(true);
  const guesses = (await get(`/hypotheses/${userId}/pending`)).body.guesses as Guess[];
  assert.deepEqual(guesses.map((g) => g.id), [believed]);
  assert.deepEqual(guesses[0]!.restsOn, [
    { kind: 'pattern', id: 'p1', text: 'Loses track of time in the workshop (4 times)' },
    { kind: 'answer', id: 'a1', text: 'What pulls them? Making furniture' },
  ]);
  assert.deepEqual(guesses[0]!.framework, { name: 'Flow', source: 'Csikszentmihalyi', wonders: 'where they are most absorbed' });
  assert.equal(guesses[0]!.createdAt.slice(0, 10), '2026-10-20');
});

test("pending lists only the requester's guesses", async () => {
  const alice = await insertUser(db), bob = await insertUser(db);
  const bobs = await guess(bob);
  await speak(true);
  assert.deepEqual((await get(`/hypotheses/${alice}/pending`)).body.guesses, []);
  assert.deepEqual(((await get(`/hypotheses/${bob}/pending`)).body.guesses as Guess[]).map((g) => g.id), [bobs]);
  assert.equal((await get(`/hypotheses/not-an-id/pending`)).status, 400);
});

test('why answers in words, reports stored as offered, and is not found for another person', async () => {
  const alice = await insertUser(db), bob = await insertUser(db);
  const id = await guess(bob, { framework: 'made_up' });
  const res = await get(`/hypotheses/${bob}/${id}/why`);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'offered');
  assert.deepEqual(res.body.framework, { name: 'made_up' }, 'an unknown framework keeps its id as the name');
  assert.deepEqual(res.body.restsOn, [
    { kind: 'pattern', id: 'p1', text: 'Loses track of time in the workshop (4 times)' },
    { kind: 'answer', id: 'a1', text: 'What pulls them? Making furniture' },
  ]);
  assert.equal((await get(`/hypotheses/${alice}/${id}/why`)).status, 404);
});

test('an answer is one word, once; a repeat is 404 (the door reads the stored status first)', async () => {
  const userId = await insertUser(db);
  const id = await guess(userId);
  assert.deepEqual((await post(`/hypotheses/${userId}/${id}`, { verdict: 'no' })).body, { status: 'declined' });
  assert.equal((await post(`/hypotheses/${userId}/${id}`, { verdict: 'yes' })).status, 404);
  assert.equal((await rowOf(id)).status, 'declined');
  assert.equal((await post(`/hypotheses/${userId}/${id}`, { verdict: 'maybe' })).status, 400);
});
