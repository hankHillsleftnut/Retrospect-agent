import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageFor, advanceOnboarding, QUIET_MS, READING_TIMEOUT_MS, type OnboardingFacts, type AdvanceDeps } from '../src/onboarding/pipeline';

/** From "just connected" to "first episode ready", one safe step at a time. */

const NOW = new Date('2026-10-19T22:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const facts = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => ({
  outstandingJobs: 0, outstandingRows: 0, lastArrivalAt: ago(QUIET_MS + 1000), startedAt: ago(5 * 60 * 1000),
  answers: 0, episodesReady: 0, episodeRunning: false, ...over,
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
