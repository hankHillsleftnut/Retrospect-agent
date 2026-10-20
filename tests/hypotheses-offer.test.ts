/** Gate F-H2 (goal 21): offered only when every gate allows; one word declines it; nothing is kept quietly. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { chooseOffer, answerHypothesis, expireHypotheses, markOffered, DIAL_DEFAULT } from '../src/hypotheses/offer';
import { readSignals } from '../src/appetite/appetite';
import { planEpisode } from '../src/planner/plan';
import { outlineFromPlan } from '../src/writer/write-episode';
import type { UnderstandingContract } from '../src/understanding/read';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

const now = new Date('2026-10-20T12:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 864e5).toISOString();
const contract = {
  userId: 'u', asOf: '2026-10-20', silent: [], goals: [], shifts: [], time: { categories: [], otherShare: 0, weeksOfBaseline: 0 }, moves: { since: null, items: [] },
  answers: [{ kind: 'answer', id: 'a1', questionId: 6, question: 'What pulls them?', domainId: 'want', answer: 'Making furniture', confidence: 0.8, sources: 3, confirmed: false, register: 'stated', lastMovedAt: null }],
  patterns: [{ kind: 'pattern', id: 'p1', label: 'Loses track of time in the workshop', confidence: 0.8, instances: 4, firstSeenAt: null, lastSeenAt: null, trajectory: null, trajectoryDetail: null, register: 'stated' }],
  whys: [{ kind: 'why', id: 'w1', patternId: 'p1', mechanism: 'avoidance', confidence: 0.6, register: 'asked' }],
} as unknown as UnderstandingContract;
const row = (over: Record<string, unknown> = {}) => ({ id: 'h1', question: 'Is the workshop where you are most absorbed?', framework: 'flow', rationale: 'four hours gone', supports: [{ kind: 'pattern', id: 'p1' }, { kind: 'answer', id: 'a1' }], offered_count: 0, last_offered_at: null, status: 'stored', created_at: ago(5), ...over });
const on = { ...DIAL_DEFAULT, speak: true };

test('nothing is offered while the dial is off, or appetite is below its bar', () => {
  assert.equal(chooseOffer([row()], contract, 3, DIAL_DEFAULT, now), null);
  assert.equal(chooseOffer([row()], contract, 1, on, now), null);
  assert.equal(chooseOffer([row()], contract, 2, on, now)?.id, 'h1');
});

test('offered at most twice, 14 days apart, and only while what it rests on is still believed', () => {
  assert.equal(chooseOffer([row({ offered_count: 2 })], contract, 2, on, now), null);
  assert.equal(chooseOffer([row({ last_offered_at: ago(3) })], contract, 2, on, now), null);
  assert.equal(chooseOffer([row({ last_offered_at: ago(20), offered_count: 1, status: 'offered' })], contract, 2, on, now)?.id, 'h1');
  assert.equal(chooseOffer([row({ supports: [{ kind: 'pattern', id: 'gone' }, { kind: 'answer', id: 'a1' }] })], contract, 2, on, now), null);
});

test('oldest first; declined or confirmed ones are never offered', () => {
  const r = chooseOffer([row({ id: 'new', created_at: ago(1) }), row({ id: 'old', created_at: ago(9) }), row({ id: 'no', status: 'declined', created_at: ago(20) })], contract, 2, on, now);
  assert.equal(r?.id, 'old');
});

test('an offered hypothesis takes the one asked slot, asked with its framework and evidence', () => {
  const offer = chooseOffer([row()], contract, 2, on, now)!;
  const plan = planEpisode(contract, {}, 6, 2, offer);
  assert.equal(plan.reflection, null, 'never a why and a hypothesis in one episode');
  const section = outlineFromPlan(plan).find((s) => s.id === 'hypothesis:h1')!;
  assert.equal(section.register, 'asked');
  assert.ok(section.facts.some((f) => f.includes('Flow')));
  assert.ok(section.facts.some((f) => f.includes('Loses track of time')));
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('"no" declines it in one word, counts as discomfort for appetite, and can not be answered twice', async () => {
  const user = await insertUser(db);
  const id = (await db.query<{ id: string }>(`INSERT INTO hypotheses (user_id, framework, question, supports) VALUES ($1, 'flow', 'Is it the workshop?', '[]') RETURNING id`, [user])).rows[0]!.id;
  await markOffered(user, id, supabase, now);
  assert.equal((await db.query<{ offered_count: number }>(`SELECT offered_count FROM hypotheses WHERE id = $1`, [id])).rows[0]!.offered_count, 1);
  assert.deepEqual(await answerHypothesis(user, id, 'no', supabase, now), { status: 'declined' });
  const signals = await readSignals(user, ago(1));
  assert.ok(signals.some((s) => s.kind === 'discomfort' && s.what.includes('declined')));
  await assert.rejects(answerHypothesis(user, id, 'yes', supabase, now));
});

test('unconfirmed past the window: expired, not kept', async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO hypotheses (user_id, framework, question, supports, created_at) VALUES ($1, 'flow', 'Old?', '[]', $2), ($1, 'flow', 'New?', '[]', $3)`, [user, ago(40), ago(2)]);
  assert.equal(await expireHypotheses(user, DIAL_DEFAULT, supabase, now), 1);
});
