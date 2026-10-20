/** F-C1 (goal 20): a correction retires what rested only on it, against a database built from the migrations. */
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
const status = async (table: string, id: string) => (await db.query<{ status: string }>(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0]!.status;

async function person() {
  const user = await insertUser(db);
  const self = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user]);
  const item = (c: string) => one(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', $2) RETURNING id`, [user, c]);
  const fact = (evidence: unknown[]) => one(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify({
    user_id: user, subject_entity_id: self, predicate: 'skipped_or_avoided', object_value: { normalized: `standup-${key()}` }, origin_key: `k-${key()}`, evidence })]);
  const pattern = async (factIds: string[]) => {
    const id = await one(`INSERT INTO behavior_patterns (user_id, slug, label, grouping_key, status) VALUES ($1, $2, 'Skips standup', $3, 'live') RETURNING id`, [user, `p-${key()}`, `g-${key()}`]);
    for (const f of factIds) await db.query(`INSERT INTO behavior_pattern_facts (pattern_id, assertion_id, user_id) VALUES ($1, $2, $3)`, [id, f, user]);
    return id;
  };
  const answer = (q: number, evidence: unknown[]) => one(`SELECT record_answer($1::jsonb) AS id`, [JSON.stringify({
    user_id: user, question_id: q, answer: 'an answer', derived_by: 'first_pass', derivation_key: `d-${key()}`, evidence })]);
  return { user, item, fact, pattern, answer };
}

test('rejecting a fact retires the pattern and answer built only on it; an answer with other support survives, minus that evidence', async () => {
  const p = await person();
  const e1 = await p.item('I skipped standup'), e2 = await p.item('I walked to work');
  const f1 = await p.fact([{ raw_content_id: e1, excerpt: 'I skipped standup' }]);
  const pat = await p.pattern([f1]);
  const onlyPattern = await p.answer(13, [{ pattern_id: pat }]);
  const mixed = await p.answer(14, [{ assertion_id: f1 }, { raw_content_id: e2, excerpt: 'I walked to work' }]);

  const plan = await applyCorrection(p.user, { kind: 'fact', id: f1 });
  assert.deepEqual(plan.retire.map((r) => r.kind).sort(), ['answer', 'fact', 'pattern']);

  assert.equal(await status('assertions', f1), 'retired');
  assert.equal(await status('behavior_patterns', pat), 'retired');
  assert.equal(await status('question_answers', onlyPattern), 'retired');
  assert.equal(await status('question_answers', mixed), 'active');
  const left = await db.query<{ n: number }>(`SELECT count(*)::int n FROM answer_evidence WHERE answer_id = $1 AND retired_at IS NULL`, [mixed]);
  assert.equal(left.rows[0]!.n, 1, 'only the walk-to-work evidence remains');
  const kept = await db.query<{ n: number }>(`SELECT count(*)::int n FROM answer_evidence WHERE answer_id = $1`, [mixed]);
  assert.equal(kept.rows[0]!.n, 2, 'the dropped evidence is retired, not deleted');
});

test('rejecting an answer marks it rejected and leaves its evidence alone', async () => {
  const p = await person();
  const f = await p.fact([{ raw_content_id: await p.item('x'), excerpt: 'x' }]);
  const a = await p.answer(15, [{ assertion_id: f }]);
  await applyCorrection(p.user, { kind: 'answer', id: a });
  const row = (await db.query<{ status: string; user_verdict: string }>(`SELECT status, user_verdict FROM question_answers WHERE id = $1`, [a])).rows[0]!;
  assert.deepEqual(row, { status: 'retired', user_verdict: 'rejected' });
  assert.equal(await status('assertions', f), 'active');
});

test('a dry run writes nothing', async () => {
  const p = await person();
  const f = await p.fact([{ raw_content_id: await p.item('y'), excerpt: 'y' }]);
  const plan = await applyCorrection(p.user, { kind: 'fact', id: f }, { dryRun: true });
  assert.equal(plan.retire.length, 1);
  assert.equal(await status('assertions', f), 'active');
});
