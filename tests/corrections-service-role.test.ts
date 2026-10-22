/**
 * BEA.1: corrections must work the way production runs them, as service_role,
 * which can't write question_answers or answer_evidence directly (migration
 * 121). PGlite runs as a superuser, which hid the 42501 that "not right" hit in
 * production; every test here switches role before applying.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { applyCorrection } from '../src/corrections/apply';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const key = () => Math.random().toString(36).slice(2);
const one = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
const row = async <T>(sql: string, params: unknown[]) => (await db.query<T>(sql, params)).rows[0]!;

async function person() {
  const user = await insertUser(db);
  const self = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user]);
  const item = (c: string) => one(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', $2) RETURNING id`, [user, c]);
  const fact = (evidence: unknown[]) => one(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify({
    user_id: user, subject_entity_id: self, predicate: 'skipped_or_avoided', object_value: { normalized: `standup-${key()}` }, origin_key: `k-${key()}`, evidence })]);
  const answerPayload = (q: number, evidence: unknown[], text = 'an answer') => JSON.stringify({
    user_id: user, question_id: q, answer: text, derived_by: 'first_pass', derivation_key: `d-${key()}`, evidence });
  const answer = (q: number, evidence: unknown[], text?: string) => one(`SELECT record_answer($1::jsonb) AS id`, [answerPayload(q, evidence, text)]);
  return { user, item, fact, answer, answerPayload };
}

async function asServiceRole<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec('SET ROLE service_role');
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE');
  }
}

test('correcting an answer works under service_role', async () => {
  const p = await person();
  const f = await p.fact([{ raw_content_id: await p.item('x'), excerpt: 'x' }]);
  const a = await p.answer(15, [{ assertion_id: f }]);
  await asServiceRole(() => applyCorrection(p.user, { kind: 'answer', id: a }));
  const after = await row<{ status: string; user_verdict: string; retirement_reason: string }>(
    `SELECT status, user_verdict, retirement_reason FROM question_answers WHERE id = $1`, [a]);
  assert.deepEqual(after, { status: 'retired', user_verdict: 'rejected', retirement_reason: 'rejected by the person' });
});

test('correcting a fact under service_role retires exactly the planned claims and evidence', async () => {
  const p = await person();
  const e1 = await p.item('I skipped standup'), e2 = await p.item('I walked to work');
  const f1 = await p.fact([{ raw_content_id: e1, excerpt: 'I skipped standup' }]);
  const only = await p.answer(13, [{ assertion_id: f1 }]);
  const mixed = await p.answer(14, [{ assertion_id: f1 }, { raw_content_id: e2, excerpt: 'I walked to work' }]);
  const plan = await asServiceRole(() => applyCorrection(p.user, { kind: 'fact', id: f1 }));
  assert.deepEqual(plan.retire.map((r) => r.kind).sort(), ['answer', 'fact']);
  assert.equal((await row<{ status: string }>(`SELECT status FROM assertions WHERE id = $1`, [f1])).status, 'retired');
  assert.equal((await row<{ status: string }>(`SELECT status FROM question_answers WHERE id = $1`, [only])).status, 'retired');
  assert.equal((await row<{ status: string }>(`SELECT status FROM question_answers WHERE id = $1`, [mixed])).status, 'active');
  const live = await row<{ n: number }>(`SELECT count(*)::int n FROM answer_evidence WHERE answer_id = $1 AND retired_at IS NULL`, [mixed]);
  assert.equal(live.n, 1, 'only the walk-to-work evidence remains live');
});

test('a failure halfway leaves the correction unapplied', async () => {
  const p = await person();
  const e1 = await p.item('a'), e2 = await p.item('b');
  const f1 = await p.fact([{ raw_content_id: e1, excerpt: 'a' }]);
  const mixed = await p.answer(16, [{ assertion_id: f1 }, { raw_content_id: e2, excerpt: 'b' }]);
  // The last step (retiring the mixed answer's evidence) fails.
  await db.exec(`
    CREATE OR REPLACE FUNCTION fail_evidence_retire() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'forced failure'; END $$;
    CREATE TRIGGER t_fail_evidence_retire BEFORE UPDATE OF retired_at ON answer_evidence
      FOR EACH ROW EXECUTE FUNCTION fail_evidence_retire();`);
  try {
    await assert.rejects(asServiceRole(() => applyCorrection(p.user, { kind: 'fact', id: f1 })));
  } finally {
    await db.exec('DROP TRIGGER t_fail_evidence_retire ON answer_evidence; DROP FUNCTION fail_evidence_retire();');
  }
  assert.equal((await row<{ status: string }>(`SELECT status FROM assertions WHERE id = $1`, [f1])).status, 'active', 'the fact is not retired');
  const rejections = await row<{ n: number }>(`SELECT count(*)::int n FROM claim_rejections WHERE user_id = $1`, [p.user]);
  assert.equal(rejections.n, 0, 'no rejection was recorded');
  const live = await row<{ n: number }>(`SELECT count(*)::int n FROM answer_evidence WHERE answer_id = $1 AND retired_at IS NULL`, [mixed]);
  assert.equal(live.n, 2);
});

test("retire_answer can't touch another user's answer", async () => {
  const alice = await person(), bob = await person();
  const f = await bob.fact([{ raw_content_id: await bob.item('z'), excerpt: 'z' }]);
  const bobs = await bob.answer(17, [{ assertion_id: f }]);
  const touched = await asServiceRole(async () => (await db.query<{ r: boolean }>(
    `SELECT retire_answer($1, $2, 'test', true) AS r`, [alice.user, bobs])).rows[0]!.r);
  assert.equal(touched, false);
  const evidence = await asServiceRole(async () => (await db.query<{ n: number }>(
    `SELECT retire_answer_evidence($1, ARRAY(SELECT id FROM answer_evidence WHERE answer_id = $2)) AS n`, [alice.user, bobs])).rows[0]!.n);
  assert.equal(evidence, 0);
  assert.equal((await row<{ status: string }>(`SELECT status FROM question_answers WHERE id = $1`, [bobs])).status, 'active');
});

test("a correction naming another user's claim changes nothing of theirs", async () => {
  const alice = await person(), bob = await person();
  const f = await bob.fact([{ raw_content_id: await bob.item('w'), excerpt: 'w' }]);
  await asServiceRole(() => db.query(`SELECT apply_correction($1::jsonb)`, [JSON.stringify({
    user_id: alice.user, target: { kind: 'fact', id: f }, retire: [{ kind: 'fact', id: f, rejected: true }], evidence_ids: [] })]));
  assert.equal((await row<{ status: string }>(`SELECT status FROM assertions WHERE id = $1`, [f])).status, 'active');
  assert.equal((await row<{ n: number }>(`SELECT count(*)::int n FROM claim_rejections WHERE source_id = $1`, [f])).n, 0);
});

test('rejecting an answer keeps it retired if a writer recreates it', async () => {
  const p = await person();
  const f = await p.fact([{ raw_content_id: await p.item('v'), excerpt: 'v' }]);
  const a = await p.answer(18, [{ assertion_id: f }], 'mornings are best');
  await asServiceRole(() => applyCorrection(p.user, { kind: 'answer', id: a }));
  // The first pass derives the same answer again, under a new key.
  const again = await asServiceRole(async () => (await db.query<{ id: string }>(
    `SELECT record_answer($1::jsonb) AS id`, [p.answerPayload(18, [{ assertion_id: f }], 'Mornings are best.')])).rows[0]!.id);
  assert.notEqual(again, a);
  assert.equal((await row<{ status: string }>(`SELECT status FROM question_answers WHERE id = $1`, [again])).status, 'retired');
});

test('the service role still cannot write answers directly', async () => {
  const p = await person();
  const f = await p.fact([{ raw_content_id: await p.item('u'), excerpt: 'u' }]);
  const a = await p.answer(19, [{ assertion_id: f }]);
  await assert.rejects(asServiceRole(() => db.query(`UPDATE question_answers SET status = 'retired' WHERE id = $1`, [a])), /permission denied/);
});
