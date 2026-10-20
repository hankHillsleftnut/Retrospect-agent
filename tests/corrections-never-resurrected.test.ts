/** Gate F-C2 (goal 20): something the person rejected is never resurrected, by any writer. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { applyCorrection, answerClaimKey, factClaimKey } from '../src/corrections/apply';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const key = () => Math.random().toString(36).slice(2);
const one = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
const row = async (sql: string, params: unknown[]) => (await db.query<Record<string, unknown>>(sql, params)).rows[0]!;

async function person() {
  const user = await insertUser(db);
  const self = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user]);
  const item = (c: string) => one(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', $2) RETURNING id`, [user, c]);
  const fact = async (object: string, originKey = `k-${key()}`) => one(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify({
    user_id: user, subject_entity_id: self, predicate: 'values', object_value: { normalized: object }, origin_key: originKey,
    evidence: [{ raw_content_id: await item(object), excerpt: object }] })]);
  const answer = async (q: number, words: string, derivationKey = `d-${key()}`) => one(`SELECT record_answer($1::jsonb) AS id`, [JSON.stringify({
    user_id: user, question_id: q, answer: words, derived_by: 'first_pass', derivation_key: derivationKey, evidence: [{ raw_content_id: await item(words), excerpt: words }] })]);
  return { user, fact, answer };
}

test('the keys in code match the keys in the database', async () => {
  for (const [pred, obj] of [['values', 'Family Time'], ['felt', '  Relieved ']] as const) {
    const sql = (await row(`SELECT fact_claim_key($1, NULL, $2::jsonb) AS k`, [pred, JSON.stringify({ normalized: obj })])).k;
    assert.equal(factClaimKey(pred, null, { normalized: obj }), sql);
  }
  for (const words of ['You want to raise money!', '  you WANT to raise   money ', 'Ça va — 100%']) {
    assert.equal(answerClaimKey(7, words), (await row(`SELECT answer_claim_key(7, $1) AS k`, [words])).k);
  }
});

test('a rejected fact found again in a new entry is stored retired', async () => {
  const p = await person();
  const f = await p.fact('hustle culture');
  await applyCorrection(p.user, { kind: 'fact', id: f });
  const again = await p.fact('Hustle Culture');
  assert.equal((await row(`SELECT status FROM assertions WHERE id = $1`, [again])).status, 'retired');
  assert.equal((await row(`SELECT status FROM assertions WHERE id = $1`, [await p.fact('family')])).status, 'active', 'unrelated facts are untouched');
});

test('re-reading the same entry keeps a rejected fact retired', async () => {
  const p = await person();
  const ok = `k-${key()}`;
  const f = await p.fact('hustle culture', ok);
  await applyCorrection(p.user, { kind: 'fact', id: f });
  await p.fact('hustle culture', ok);
  assert.equal((await row(`SELECT status FROM assertions WHERE id = $1`, [f])).status, 'retired');
});

test('a rejected answer re-derived in the same words, any case or punctuation, stays retired', async () => {
  const p = await person();
  const a = await p.answer(21, 'You want to raise a seed round.');
  await applyCorrection(p.user, { kind: 'answer', id: a });
  const fresh = await p.answer(21, 'you want to raise a SEED round');
  assert.equal((await row(`SELECT status FROM question_answers WHERE id = $1`, [fresh])).status, 'retired');
});

test('the upsert under the same key cannot reactivate a rejected answer', async () => {
  const p = await person();
  const dk = `d-${key()}`;
  const a = await p.answer(22, 'You want to raise a seed round.', dk);
  await applyCorrection(p.user, { kind: 'answer', id: a });
  await p.answer(22, 'You want to raise a seed round.', dk);
  assert.equal((await row(`SELECT status FROM question_answers WHERE id = $1`, [a])).status, 'retired');
});

test('re-derived to genuinely different words, the answer is live again and the old verdict is cleared', async () => {
  const p = await person();
  const dk = `d-${key()}`;
  const a = await p.answer(23, 'You want to raise a seed round.', dk);
  await applyCorrection(p.user, { kind: 'answer', id: a });
  await p.answer(23, 'You want to bootstrap to profitability.', dk);
  assert.deepEqual(await row(`SELECT status, user_verdict FROM question_answers WHERE id = $1`, [a]), { status: 'active', user_verdict: null });
});

test('"it changed" retires the fact as of now without blacklisting it; said again later, it is believed again', async () => {
  const p = await person();
  const f = await p.fact('working at Figma');
  await applyCorrection(p.user, { kind: 'fact', id: f }, { mode: 'changed' });
  assert.equal((await row(`SELECT status FROM assertions WHERE id = $1`, [f])).status, 'retired');
  assert.equal(Number((await row(`SELECT count(*) AS n FROM claim_rejections WHERE user_id = $1`, [p.user])).n), 0);
  assert.equal((await row(`SELECT status FROM assertions WHERE id = $1`, [await p.fact('working at Figma')])).status, 'active');
});
