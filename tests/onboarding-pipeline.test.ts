import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { stageFor, advanceOnboarding, loadOnboardingFacts, QUIET_MS, READING_TIMEOUT_MS, type OnboardingFacts, type AdvanceDeps } from '../src/onboarding/pipeline';
import { makeFirstPassStep } from '../src/jobs/onboarding-pipeline';
import { runFirstPass } from '../src/questions/run-first-pass';
import { usageLines } from '../src/pipelines/spend-ledger';
import { supabase } from '../src/db/supabase';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';

/** From "just connected" to "first episode ready", one safe step at a time. */

const NOW = new Date('2026-10-19T22:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const facts = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => ({
  outstandingJobs: 0, outstandingRows: 0, lastArrivalAt: ago(QUIET_MS + 1000), startedAt: ago(5 * 60 * 1000),
  answers: 0, firstPassRuns: 0, episodesReady: 0, episodeRunning: false, ...over,
});

test('still reading while jobs or entries are outstanding', () => {
  assert.equal(stageFor(facts({ outstandingJobs: 3 }), NOW), 'reading');
  assert.equal(stageFor(facts({ outstandingRows: 12 }), NOW), 'reading');
});

test('still reading if material arrived moments ago, even with nothing queued', () => {
  assert.equal(stageFor(facts({ lastArrivalAt: ago(10_000) }), NOW), 'reading');
});

test('nobody waits on reading forever: after the timeout it moves on regardless', () => {
  assert.equal(stageFor(facts({ outstandingJobs: 3, startedAt: ago(READING_TIMEOUT_MS + 1) }), NOW), 'understanding');
});

test('read, then answered, then an episode: understanding -> making_episode -> ready', () => {
  assert.equal(stageFor(facts(), NOW), 'understanding');
  assert.equal(stageFor(facts({ answers: 28 }), NOW), 'making_episode');
  assert.equal(stageFor(facts({ answers: 28, episodesReady: 1 }), NOW), 'ready');
});

test('a first pass that answered nothing is not run again: the episode comes next', () => {
  assert.equal(stageFor(facts({ answers: 0, firstPassRuns: 1 }), NOW), 'making_episode');
  assert.equal(stageFor(facts({ answers: 0, firstPassRuns: 1, episodesReady: 1 }), NOW), 'ready');
  // Someone with answers behaves exactly as before, tried or not.
  assert.equal(stageFor(facts({ answers: 28, firstPassRuns: 0 }), NOW), 'making_episode');
  assert.equal(stageFor(facts({ answers: 28, firstPassRuns: 2 }), NOW), 'making_episode');
});

function steps(f: OnboardingFacts, mayMakeEpisode = true) {
  const done: string[] = [];
  const deps: AdvanceDeps = {
    loadFacts: async () => f,
    firstPass: async () => { done.push('first_pass'); },
    makeEpisode: async () => { done.push('episode'); },
    mayMakeEpisode: async () => mayMakeEpisode,
    now: () => NOW,
  };
  return { done, deps };
}

test('advance runs the first pass once reading is done, and nothing else', async () => {
  const { done, deps } = steps(facts());
  assert.deepEqual(await advanceOnboarding('u', deps), { stage: 'understanding', action: 'ran_first_pass' });
  assert.deepEqual(done, ['first_pass']);
});

test('advance makes the first episode after the first pass', async () => {
  const { done, deps } = steps(facts({ answers: 30 }));
  assert.equal((await advanceOnboarding('u', deps)).action, 'made_episode');
  assert.deepEqual(done, ['episode']);
});

test('never two episodes: one already being made is left alone', async () => {
  const { done, deps } = steps(facts({ answers: 30, episodeRunning: true }));
  assert.equal((await advanceOnboarding('u', deps)).action, 'episode_already_running');
  assert.deepEqual(done, []);
});

test('the spending ceiling is respected', async () => {
  const { done, deps } = steps(facts({ answers: 30 }), false);
  assert.equal((await advanceOnboarding('u', deps)).action, 'over_spending_limit');
  assert.deepEqual(done, []);
});

test('nothing happens while reading, or once ready', async () => {
  const reading = steps(facts({ outstandingJobs: 1 }));
  assert.equal((await advanceOnboarding('u', reading.deps)).action, 'waiting_for_reading');
  const ready = steps(facts({ answers: 30, episodesReady: 1 }));
  assert.equal((await advanceOnboarding('u', ready.deps)).action, 'nothing_to_do');
  assert.deepEqual([...reading.done, ...ready.done], []);
});

// ── The first pass runs once (BE2.5.guard), against a database built from the migrations ──

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const ledger = async (userId: string) => (await db.query<{ kind: string; usd: string }>(
  `SELECT kind, usd::text FROM spend_ledger WHERE user_id = $1 ORDER BY at`, [userId])).rows;
const allowed = async () => ({ allowed: true });
const nothingAnswered = async () => ({ cost: usageLines([{ model: 'claude-sonnet-5-5', usage: { inputTokens: 0, outputTokens: 0 } }]) });

/** One pipeline tick for one person: real facts and the real first-pass step; the episode is a stub. */
async function tick(userId: string, firstPass: AdvanceDeps['firstPass'], done: string[], mayMakeEpisode = true) {
  return advanceOnboarding(userId, {
    loadFacts: (id) => loadOnboardingFacts(id, supabase),
    firstPass: async (id) => { done.push('first_pass'); return firstPass(id); },
    makeEpisode: async () => { done.push('episode'); },
    mayMakeEpisode: async () => mayMakeEpisode,
  });
}

test('a first pass that records no answers: the second tick makes the episode, not a second first pass', async () => {
  const userId = await insertUser(db);
  const done: string[] = [];
  const step = makeFirstPassStep({ checkSpend: allowed, run: nothingAnswered });
  assert.equal((await tick(userId, step, done)).action, 'ran_first_pass');
  assert.deepEqual(await ledger(userId), [{ kind: 'first_pass', usd: '0.000000' }], 'the try is marked at $0');
  assert.equal((await tick(userId, step, done)).action, 'made_episode');
  assert.deepEqual(done, ['first_pass', 'episode']);
});

test('an empty pool calls no model, leaves a $0 row, and the episode is next', async () => {
  const userId = await insertUser(db);
  const step = makeFirstPassStep({
    checkSpend: allowed,
    run: (id) => runFirstPass(id, { db: supabase, model: async () => { throw new Error('must not be called'); } }),
  });
  await step(userId);
  assert.deepEqual(await ledger(userId), [{ kind: 'first_pass', usd: '0.000000' }]);
  const f = await loadOnboardingFacts(userId, supabase);
  assert.equal(f.answers, 0);
  assert.equal(f.firstPassRuns, 1);
  assert.equal(stageFor(f, new Date()), 'making_episode');
});

test('a first pass that cost money records its cost once, with no extra $0 row', async () => {
  const userId = await insertUser(db);
  const step = makeFirstPassStep({ checkSpend: allowed, run: async () => ({ cost: usageLines([{ model: 'claude-sonnet-5-5', usage: { inputTokens: 1000, outputTokens: 200 } }]) }) });
  await step(userId);
  assert.deepEqual(await ledger(userId), [{ kind: 'first_pass', usd: '0.004000' }]);
});

test('a first pass refused by the spending cap records nothing and is tried again next tick', async () => {
  const userId = await insertUser(db);
  const ran: string[] = [];
  const run = async (id: string) => { ran.push(id); return nothingAnswered(); };
  const done: string[] = [];
  const refused = makeFirstPassStep({ checkSpend: async () => ({ allowed: false, message: 'limit' }), run });
  assert.equal((await tick(userId, refused, done)).action, 'ran_first_pass');
  assert.deepEqual(ran, [], 'no model was reached');
  assert.deepEqual(await ledger(userId), []);
  // The cap resets: it runs, once.
  const open = makeFirstPassStep({ checkSpend: allowed, run });
  assert.equal((await tick(userId, open, done)).action, 'ran_first_pass');
  assert.equal((await tick(userId, open, done)).action, 'made_episode');
  assert.equal(ran.length, 1);
});

test("one person's first pass never moves another person on", async () => {
  const a = await insertUser(db), b = await insertUser(db);
  await makeFirstPassStep({ checkSpend: allowed, run: nothingAnswered })(a);
  assert.equal((await loadOnboardingFacts(a, supabase)).firstPassRuns, 1);
  const fb = await loadOnboardingFacts(b, supabase);
  assert.equal(fb.firstPassRuns, 0);
  assert.equal(stageFor(fb, new Date()), 'understanding');
});
