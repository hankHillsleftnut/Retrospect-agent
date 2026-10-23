import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { stageFor, advanceOnboarding, loadOnboardingFacts, QUIET_MS, READING_TIMEOUT_MS, type OnboardingFacts, type AdvanceDeps } from '../src/onboarding/pipeline';
import { makeFirstPassStep, onePerPerson, runOnboardingPipeline } from '../src/jobs/onboarding-pipeline';
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
  answers: 0, firstPassRuns: 0, episodesReady: 0, episodeRunning: false, access: 'member', ...over,
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
  // users.access comes from the backend's migration 007 (the database is shared); mirrored here as it is applied.
  await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS access TEXT;
    UPDATE users SET access = 'member' WHERE access IS NULL;
    ALTER TABLE users ALTER COLUMN access SET DEFAULT 'waitlisted';
    ALTER TABLE users ALTER COLUMN access SET NOT NULL;
    ALTER TABLE users ADD CONSTRAINT users_access_check CHECK (access IN ('waitlisted', 'approved', 'member', 'staff', 'suspended'));`);
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

/** A person who has finished the questions (POST /v2/onboarding/complete made them a member). */
const member = async (pg: PGlite) => {
  const id = await insertUser(pg);
  await setAccess(id, 'member');
  return id;
};
const setAccess = (id: string, access: string) => db.query(`UPDATE users SET access = $2 WHERE id = $1`, [id, access]);

const ledger = async (userId: string) => (await db.query<{ kind: string; usd: string }>(
  `SELECT kind, usd::text FROM spend_ledger WHERE user_id = $1 ORDER BY at`, [userId])).rows;
const allowed = async () => ({ allowed: true });
/** Had material to read, answered nothing, cost nothing (every domain skipped). */
const nothingAnswered = async () => ({ poolSize: 3, cost: usageLines([{ model: 'claude-sonnet-5-5', usage: { inputTokens: 0, outputTokens: 0 } }]) });
const paidRun = async () => ({ poolSize: 3, cost: usageLines([{ model: 'claude-sonnet-5-5', usage: { inputTokens: 1000, outputTokens: 200 } }]) });

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
  const userId = await member(db);
  const done: string[] = [];
  const step = makeFirstPassStep({ checkSpend: allowed, run: nothingAnswered });
  assert.equal((await tick(userId, step, done)).action, 'ran_first_pass');
  assert.deepEqual(await ledger(userId), [{ kind: 'first_pass', usd: '0.000000' }], 'the try is marked at $0');
  assert.equal((await tick(userId, step, done)).action, 'made_episode');
  assert.deepEqual(done, ['first_pass', 'episode']);
});

test('an empty pool (nothing arrived yet) calls no model, marks nothing, and waits for material', async () => {
  const userId = await member(db);
  const step = makeFirstPassStep({
    checkSpend: allowed,
    run: (id) => runFirstPass(id, { db: supabase, model: async () => { throw new Error('must not be called'); } }),
  });
  await step(userId);
  assert.deepEqual(await ledger(userId), [], 'no episode made from nothing: the first pass is still to come');
  const f = await loadOnboardingFacts(userId, supabase);
  assert.equal(f.firstPassRuns, 0);
  assert.equal(stageFor(f, new Date()), 'understanding');
});

test('a first pass that cost money records its cost once, with no extra $0 row', async () => {
  const userId = await member(db);
  await makeFirstPassStep({ checkSpend: allowed, run: paidRun })(userId);
  assert.deepEqual(await ledger(userId), [{ kind: 'first_pass', usd: '0.004000' }]);
});

test('a paid first pass whose cost could not be written is not passed off as a $0 try', async () => {
  const inserts: unknown[] = [];
  const failing = { from: () => ({ insert: async (rows: unknown) => { inserts.push(rows); return { error: { code: 'XX000' } }; } }) } as unknown as typeof supabase;
  await makeFirstPassStep({ checkSpend: allowed, run: paidRun, db: failing })('u-failing-write');
  assert.equal(inserts.length, 1, 'only the cost write, no $0 marker');
  assert.ok((inserts[0] as Array<{ usd: number }>).every((r) => r.usd > 0));
});

test('two callers at once (cron tick and POST /onboarding/advance) pay for one first pass', async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const step = onePerPerson(async () => { runs += 1; await gate; return null; });
  const first = step('u-race');
  assert.equal(await step('u-race'), null, 'the second caller steps aside');
  release();
  await first;
  assert.equal(runs, 1);
  // Once finished, the person can be stepped again (the stage decides whether to).
  await step('u-race');
  assert.equal(runs, 2);
});

test('a first pass refused by the spending cap records nothing and is tried again next tick', async () => {
  const userId = await member(db);
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
  const a = await member(db), b = await member(db);
  await makeFirstPassStep({ checkSpend: allowed, run: nothingAnswered })(a);
  assert.equal((await loadOnboardingFacts(a, supabase)).firstPassRuns, 1);
  const fb = await loadOnboardingFacts(b, supabase);
  assert.equal(fb.firstPassRuns, 0);
  assert.equal(stageFor(fb, new Date()), 'understanding');
});

// ── Nothing is made until they finish the questions (BE2.5.wait) ──

test('still answering (approved or waitlisted): they wait, even with answers in and the reading timeout long past', () => {
  const old = ago(READING_TIMEOUT_MS * 10);
  for (const access of ['approved', 'waitlisted', 'suspended']) {
    assert.equal(stageFor(facts({ access }), NOW), 'reading', access);
    assert.equal(stageFor(facts({ access, startedAt: old, lastArrivalAt: null }), NOW), 'reading', access);
    assert.equal(stageFor(facts({ access, answers: 28, firstPassRuns: 1 }), NOW), 'reading', access);
  }
  // Members, staff and a database without the column behave exactly as before, old accounts included.
  for (const access of ['member', 'staff', null]) {
    assert.equal(stageFor(facts({ access, startedAt: old, lastArrivalAt: null }), NOW), 'understanding', String(access));
    assert.equal(stageFor(facts({ access, answers: 28 }), NOW), 'making_episode', String(access));
    assert.equal(stageFor(facts({ access, answers: 28, episodesReady: 1 }), NOW), 'ready', String(access));
  }
});

/** Their answers are in and read; the account is an hour old (they waited for an invite). */
async function answered(userId: string) {
  await db.query(`UPDATE users SET created_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [userId]);
  await db.query(
    `INSERT INTO raw_content (user_id, content_type, content, processing_status, created_at) VALUES ($1, 'journal_entry', 'an answer', 'completed', NOW() - INTERVAL '10 minutes')`,
    [userId],
  );
}

/** A first-pass step that counts the runs that reach the model. */
function countedStep() {
  const ran: string[] = [];
  const step = makeFirstPassStep({ checkSpend: allowed, run: async (id) => { ran.push(id); return paidRun(); } });
  return { ran, step };
}

test('an approved person with answers waits: no first pass, no model, no spend; once a member, first pass then episode', async () => {
  const userId = await insertUser(db);
  await setAccess(userId, 'approved');
  await answered(userId);
  const { ran, step } = countedStep();
  const done: string[] = [];
  assert.deepEqual(await tick(userId, step, done), { stage: 'reading', action: 'waiting_for_reading' });
  assert.deepEqual(await tick(userId, step, done), { stage: 'reading', action: 'waiting_for_reading' });
  assert.deepEqual([done, ran, await ledger(userId)], [[], [], []]);
  // POST /v2/onboarding/complete after the last answer: approved -> member.
  await setAccess(userId, 'member');
  assert.equal((await tick(userId, step, done)).action, 'ran_first_pass');
  assert.deepEqual(await ledger(userId), [{ kind: 'first_pass', usd: '0.004000' }]);
  assert.equal((await tick(userId, step, done)).action, 'made_episode');
  assert.deepEqual(done, ['first_pass', 'episode']);
  assert.equal(ran.length, 1, 'the first pass ran once');
});

test('a waitlisted person (the default for a new account) waits too', async () => {
  const userId = await insertUser(db);
  await answered(userId);
  const { ran, step } = countedStep();
  const done: string[] = [];
  assert.equal((await loadOnboardingFacts(userId, supabase)).access, 'waitlisted');
  assert.equal((await tick(userId, step, done)).action, 'waiting_for_reading');
  assert.deepEqual([done, ran, await ledger(userId)], [[], [], []]);
});

test("one person still answering never holds back another, and finishing moves only them on", async () => {
  const a = await insertUser(db), b = await member(db);
  await setAccess(a, 'approved');
  await answered(a);
  await answered(b);
  const { ran, step } = countedStep();
  const done: string[] = [];
  assert.equal((await tick(a, step, done)).action, 'waiting_for_reading');
  assert.equal((await tick(b, step, done)).action, 'ran_first_pass');
  assert.deepEqual(ran, [b]);
  assert.deepEqual(await ledger(a), []);
  await setAccess(a, 'member');
  assert.equal((await tick(a, step, done)).action, 'ran_first_pass');
  assert.deepEqual(ran, [b, a]);
  assert.equal((await ledger(b)).length, 1, "a's run is not counted against b");
});

test('someone invited after waiting more than three days is still stepped once they answer; an old account with no answers is not', async () => {
  const invitedLate = await member(db), oldQuiet = await member(db);
  await db.query(`UPDATE users SET created_at = NOW() - INTERVAL '5 days' WHERE id = ANY($1)`, [[invitedLate, oldQuiet]]);
  await db.query(
    `INSERT INTO raw_content (user_id, content_type, content, processing_status) VALUES ($1, 'onboarding_profile', 'their answers', 'completed'), ($1, 'onboarding_profile', 'their answers, later', 'completed')`,
    [invitedLate],
  );
  const stepped: string[] = [];
  await runOnboardingPipeline({
    loadFacts: async (id) => { stepped.push(id); return facts(); },
    firstPass: async () => null, makeEpisode: async () => null, mayMakeEpisode: async () => false, now: () => NOW,
  });
  assert.ok(stepped.includes(invitedLate), 'their answers are recent, so they are in');
  assert.ok(!stepped.includes(oldQuiet), 'old members with nothing new are left alone');
  assert.equal(stepped.filter((id) => id === invitedLate).length, 1, 'once per tick, though they have several answer rows');
});
