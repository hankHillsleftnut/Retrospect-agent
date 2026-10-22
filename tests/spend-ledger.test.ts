/**
 * BEA.4: every model call counted, and the cap enforced. Against a real
 * database built from the migrations (153 adds the ledger); routes are called
 * over HTTP with their engines injected, so a test can prove the engine was
 * never reached on a refusal.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { config } from '../src/config';
import { checkDailySpend, spendSince, projectSpendSince } from '../src/pipelines/spend-guard';
import { recordSpend, usageLines } from '../src/pipelines/spend-ledger';
import { makeConversationRouter } from '../src/routes/conversation';
import { makeCorrectionsRouter } from '../src/routes/corrections';
import { makeSearchRouter } from '../src/routes/search';
import { makeBriefsRouter } from '../src/routes/briefs';
import { makeNotificationsRouter } from '../src/routes/notifications';
import { makeOnboardingRouter } from '../src/routes/onboarding';
import { runDailyBrief } from '../src/briefs/run-daily-brief';
import type { ConverseResult } from '../src/conversation/reply';
import type { CorrectionResult } from '../src/corrections/target';
import type { SearchResult } from '../src/search/answer';

const NOW = new Date('2026-10-22T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
/** 1,000 in + 200 out, priced by the trace price table: claude-sonnet-5-5 ($2 / $10 per M) = $0.004; claude-sonnet-4-6 ($3 / $15) = $0.006. */
const u = { inputTokens: 1000, outputTokens: 200 };
const WRITER_USD = 0.004;
const PRICE: Record<string, number> = { 'claude-sonnet-5-5': 0.004, 'claude-sonnet-4-6': 0.006 };

let db: PGlite;
let server: Server;
let base = '';
const calls: string[] = [];
const checkSpend = (userId: string) => checkDailySpend(userId, { capUsd: 5, now: NOW });

before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });

  const app = express();
  app.use(express.json());
  app.use('/conversation', makeConversationRouter({ checkSpend, converse: async (userId) => {
    calls.push('conversation');
    return { intent: 'chat', reply: 'ok', cut: [], used: [], usage: u, cost: usageLines([{ model: config.anthropic.writerModel, usage: u }]) } as ConverseResult;
  } }));
  app.use('/corrections', makeCorrectionsRouter({ checkSpend, handleCorrection: async () => {
    calls.push('correction');
    return { outcome: 'not_a_correction', usage: u } as CorrectionResult;
  } }));
  app.use('/search', makeSearchRouter({ checkSpend, searchAndAnswer: async (_userId, query) => {
    calls.push('search');
    return { query, summary: 'x', abstained: false, sources: [], cut: [], usage: { rewrite: { inputTokens: 0, outputTokens: 0 }, write: u, guard: { inputTokens: 0, outputTokens: 0 } } } as SearchResult;
  } }));
  app.use('/briefs', makeBriefsRouter({ checkSpend, runDailyBrief: async (userId, deps) => {
    calls.push('brief');
    // No voice here: the brief's own spend is the point of this test, not its audio.
    return runDailyBrief(userId, { ...deps, now: NOW, model: async () => ({ data: { through_line: 'x', items: [] }, usage: u }), makeAudio: async () => ({ outcome: 'quiet' }) });
  } }));
  app.use('/notifications', makeNotificationsRouter({ checkSpend, model: async () => {
    calls.push('notification');
    return { data: { morning: { title: 't', body: 'b' }, evening: { title: 't', body: 'b' } }, usage: u };
  } }));
  app.use('/onboarding', makeOnboardingRouter({ checkSpend,
    extractStatedGoals: async () => { calls.push('onboarding_goals'); return { goals: [], dropped: 0, usage: u, model: config.anthropic.writerModel }; },
    runMagicMoments: async () => { calls.push('onboarding_interpret'); return { moments: [], hadOnboarding: false, integrationTypes: [], cost: usageLines([{ model: config.anthropic.writerModel, usage: u }]) }; },
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const ledger = async (userId: string) => (await db.query<{ kind: string; usd: string; model: string | null; is_test: boolean }>(
  `SELECT kind, usd::text, model, is_test FROM spend_ledger WHERE user_id = $1 ORDER BY at, kind`, [userId])).rows;
async function trace(userId: string, usd: number, at = hoursAgo(1)) {
  await db.query(`INSERT INTO pipeline_run_traces (user_id, kind, status, started_at, cost_breakdown) VALUES ($1, 'podcast', 'completed', $2, $3)`, [userId, at, JSON.stringify({ est_usd: usd })]);
}
async function withBriefs(userId: string) {
  await db.query(`UPDATE users SET daily_brief_enabled = true WHERE id = $1`, [userId]);
}
/** Something new today, so the brief calls the model instead of being quiet. */
async function withMaterial(userId: string) {
  await db.query(`INSERT INTO raw_content (user_id, content_type, content, created_at) VALUES ($1, 'journal_entry', 'test entry', $2)`, [userId, hoursAgo(2)]);
}

// ── Recording ────────────────────────────────────────────────────────────────

const ROUTES: Array<{ kind: string; method: string; path: string; model: string; body: (userId: string) => unknown; setup?: (userId: string) => Promise<void> }> = [
  { kind: 'conversation', method: 'POST', path: '/conversation', model: config.anthropic.writerModel, body: (userId) => ({ userId, text: 'hello' }) },
  { kind: 'correction', method: 'POST', path: '/corrections', model: config.anthropic.writerModel, body: (userId) => ({ userId, text: 'not right' }) },
  { kind: 'search', method: 'POST', path: '/search/answer', model: config.anthropic.writerModel, body: (userId) => ({ userId, q: 'fear' }) },
  { kind: 'brief', method: 'POST', path: '/briefs/generate', model: config.anthropic.questionsModel, body: (userId) => ({ userId }), setup: async (userId) => { await withBriefs(userId); await withMaterial(userId); } },
  { kind: 'notification', method: 'POST', path: '/notifications/generate', model: config.anthropic.cookBModel, body: (userId) => ({ userId }) },
  { kind: 'onboarding_goals', method: 'POST', path: '/onboarding/goals', model: config.anthropic.writerModel, body: (userId) => ({ userId, answersText: 'I want to run more' }) },
  { kind: 'onboarding_interpret', method: 'POST', path: '/onboarding/interpret', model: config.anthropic.writerModel, body: (userId) => ({ userId }) },
];

for (const r of ROUTES) {
  test(`every model-calling route records its cost: ${r.kind}`, async () => {
    const userId = await insertUser(db);
    await r.setup?.(userId);
    const res = await call(r.method, r.path, r.body(userId));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = await ledger(userId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, r.kind);
    const expected = PRICE[r.model];
    assert.ok(expected, `price the test knows for ${r.model}`);
    assert.equal(Number(rows[0]!.usd), expected);
    assert.equal(rows[0]!.model, r.model);
    assert.equal(rows[0]!.is_test, false);
    // And the guard now sees it.
    const s = await spendSince(userId, hoursAgo(24));
    assert.equal(Number(s.totalUsd.toFixed(4)), expected);
    assert.deepEqual(Object.keys(s.byKind), [r.kind]);
  });
}

test('a quiet brief calls no model and spends nothing', async () => {
  const userId = await insertUser(db);
  await runDailyBrief(userId, { now: NOW, model: async () => { throw new Error('must not be called'); } });
  assert.deepEqual(await ledger(userId), []);
});

test('the brief engine records whichever way it is reached, including a dry run', async () => {
  const userId = await insertUser(db);
  await withMaterial(userId);
  const model = async () => ({ data: { through_line: 'x', items: [] }, usage: u });
  await runDailyBrief(userId, { now: NOW, dryRun: true, model, makeAudio: async () => ({ outcome: 'quiet' }) });
  const rows = await ledger(userId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kind, 'brief');
  assert.equal(Number(rows[0]!.usd), WRITER_USD);
});

test('a free call writes no ledger row', async () => {
  const userId = await insertUser(db);
  assert.equal(await recordSpend(userId, 'search', usageLines([{ model: 'claude-haiku-5-5', usage: { inputTokens: 0, outputTokens: 0 } }])), 0);
  assert.deepEqual(await ledger(userId), []);
});

test('a dev-test account is marked is_test by the database, a real one is not', async () => {
  const tester = await insertUser(db, 'dev-test-user:1@test');
  await db.query(`UPDATE users SET apple_user_id = 'dev-test-user:abc' WHERE id = $1`, [tester]);
  const real = await insertUser(db);
  await recordSpend(tester, 'search', usageLines([{ model: config.anthropic.writerModel, usage: u }]));
  await recordSpend(real, 'search', usageLines([{ model: config.anthropic.writerModel, usage: u }]));
  assert.equal((await ledger(tester))[0]!.is_test, true);
  assert.equal((await ledger(real))[0]!.is_test, false);
  // Test spend still counts toward that account's own cap.
  assert.equal(Number((await spendSince(tester, hoursAgo(24))).totalUsd.toFixed(4)), WRITER_USD);
});

// ── Enforcement ──────────────────────────────────────────────────────────────

test('over the cap a model route is refused and a read is not', async () => {
  const userId = await insertUser(db);
  await withBriefs(userId);
  await trace(userId, 5.5);
  calls.length = 0;
  for (const r of ROUTES) {
    const res = await call(r.method, r.path, r.body(userId));
    assert.equal(res.status, 429, `${r.path}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, 'spend_limited');
    assert.equal(res.body.capUsd, 5);
    assert.equal(res.body.spentUsd, 5.5);
    assert.equal(res.body.scope, 'person');
  }
  assert.deepEqual(calls, [], 'no engine was called on a refusal');
  assert.deepEqual(await ledger(userId), [], 'nothing was spent');
  // Reads for the same over-cap person still answer.
  assert.equal((await call('GET', `/conversation/${userId}/today`)).status, 200);
  assert.equal((await call('GET', `/briefs/${userId}/latest`)).status, 200);
  assert.equal((await call('GET', `/onboarding/readiness/${userId}`)).status, 200);
});

test("one person's spending never refuses another", async () => {
  const heavy = await insertUser(db), light = await insertUser(db);
  // Seeded through the ledger itself, so this guards the ledger read's user scope.
  await recordSpend(heavy, 'search', usageLines([{ model: config.anthropic.writerModel, usage: { inputTokens: 5_000_000, outputTokens: 1_000_000 } }]), { now: NOW });
  assert.equal((await call('POST', '/conversation', { userId: light, text: 'hi' })).status, 200);
  assert.equal((await call('POST', '/conversation', { userId: heavy, text: 'hi' })).status, 429);
});

test('briefs/generate respects the switch', async () => {
  const userId = await insertUser(db);
  calls.length = 0;
  const off = await call('POST', '/briefs/generate', { userId });
  assert.equal(off.status, 409);
  assert.deepEqual(off.body, { error: 'briefs are off for this person' });
  assert.deepEqual(calls, [], 'no brief was made');
  // A dry run saves nothing, so it may run while the switch is off.
  assert.equal((await call('POST', '/briefs/generate', { userId, dryRun: true })).status, 200);
  assert.deepEqual(calls, ['brief']);
  await withBriefs(userId);
  assert.equal((await call('POST', '/briefs/generate', { userId })).status, 200);
  assert.equal((await call('POST', '/briefs/generate', { userId: '00000000-0000-0000-0000-000000000000' })).status, 404);
});

test('the staging cap stops everyone in staging only', async () => {
  const a = await insertUser(db), b = await insertUser(db), c = await insertUser(db);
  await trace(a, 2);
  await trace(b, 2);
  // The database is shared with the other tests here, so the project total is read, not assumed.
  const project = (await projectSpendSince(hoursAgo(24))).totalUsd;
  assert.ok(project >= 4, 'a and b are in the project total');
  const staging = { RETROSPECT_ENV: 'staging', STAGING_DAILY_CAP_USD: '3' } as NodeJS.ProcessEnv;
  const refused = await checkDailySpend(c, { capUsd: 15, now: NOW, env: staging });
  assert.equal(refused.allowed, false);
  if (!refused.allowed) {
    assert.equal(refused.scope, 'project');
    assert.equal(refused.spentUsd, project, "the project's figure, not c's own zero");
    assert.equal(refused.capUsd, 3, 'the project cap, not the per-person one');
    assert.match(refused.message, /Staging limit reached/);
  }
  // The same numbers outside staging, or with no staging cap set, refuse nobody.
  assert.equal((await checkDailySpend(c, { capUsd: 15, now: NOW, env: { RETROSPECT_ENV: 'production', STAGING_DAILY_CAP_USD: '3' } })).allowed, true);
  assert.equal((await checkDailySpend(c, { capUsd: 15, now: NOW, env: { RETROSPECT_ENV: 'staging' } })).allowed, true);
  // Under the project cap, staging lets people through.
  assert.equal((await checkDailySpend(c, { capUsd: 15, now: NOW, env: { RETROSPECT_ENV: 'staging', STAGING_DAILY_CAP_USD: String(Math.ceil(project) + 50) } })).allowed, true);
});

test('a busy day of more than a thousand rows is summed in full', async () => {
  // PostgREST (and the fake) answer at most 1,000 rows per request; 1,001 cents must still add up to over $10.
  const userId = await insertUser(db);
  await db.query(
    `INSERT INTO spend_ledger (user_id, at, kind, usd, model) SELECT $1, $2::timestamptz, 'search', 0.01, 'm' FROM generate_series(1, 1001)`,
    [userId, hoursAgo(1)],
  );
  const s = await spendSince(userId, hoursAgo(24));
  assert.equal(Number(s.totalUsd.toFixed(2)), 10.01);
  // A cap between the first page's $10.00 and the true $10.01: a read of one page alone would let this through.
  assert.equal((await checkDailySpend(userId, { capUsd: 10.005, now: NOW })).allowed, false, 'the cap is not missed');
  const project = await projectSpendSince(hoursAgo(24));
  assert.ok(project.totalUsd >= 10.01, 'the project read pages too');
});

test('the staging refusal is a 429 at the door too', async () => {
  const userId = await insertUser(db);
  const app = express();
  app.use(express.json());
  app.use('/conversation', makeConversationRouter({
    checkSpend: (id) => checkDailySpend(id, { capUsd: 15, now: NOW, env: { RETROSPECT_ENV: 'staging', STAGING_DAILY_CAP_USD: '1' } }),
    converse: async () => { throw new Error('must not be called'); },
  }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => s.once('listening', () => resolve()));
  try {
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/conversation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, text: 'hi' }) });
    assert.equal(res.status, 429);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'spend_limited');
    assert.equal(body.scope, 'project');
  } finally {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});
