/** W4.2: what moved in the answers since the last episode. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { answerMoves, confidenceAt, readAnswerMoves, type EvidenceRow } from '../src/understanding/answer-moves';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

const since = new Date('2026-10-12T00:00:00Z'), now = new Date('2026-10-19T00:00:00Z');
const ev = (id: string, stance: EvidenceRow['stance'], created: string, source = id): EvidenceRow =>
  ({ id, answer_id: 'a', stance, source_key: source, observed_at: created, created_at: created, weight: 1 });
const answer = (created = '2026-09-01T00:00:00Z') => [{ id: 'a', question_id: 6, created_at: created, half_life_days: 365 }];

test('new supporting evidence that lifts confidence is a move, with the evidence that moved it', () => {
  const [m] = answerMoves(answer(), [ev('e1', 'supports', '2026-09-01T00:00:00Z'), ev('e2', 'supports', '2026-10-15T00:00:00Z'), ev('e3', 'supports', '2026-10-16T00:00:00Z')], since, now);
  assert.equal(m!.isNew, false);
  assert.ok(m!.after - m!.before! >= 0.15, JSON.stringify(m));
  assert.deepEqual(m!.evidenceIds, ['e2', 'e3']);
});

test('fading with time alone is not a move', () => {
  assert.deepEqual(answerMoves([{ id: 'a', question_id: 6, created_at: '2026-01-01T00:00:00Z', half_life_days: 14 }], [ev('e1', 'supports', '2026-01-01T00:00:00Z')], since, now), []);
});

test('contradicting evidence moves it down, and a brand-new answer is reported as new', () => {
  const [down] = answerMoves(answer(), [ev('e1', 'supports', '2026-09-01T00:00:00Z'), ev('e2', 'supports', '2026-09-02T00:00:00Z'), ev('x1', 'contradicts', '2026-10-14T00:00:00Z'), ev('x2', 'contradicts', '2026-10-15T00:00:00Z')], since, now);
  assert.ok(down!.after < down!.before!);
  assert.equal(down!.newContradicting, 2);
  const [fresh] = answerMoves(answer('2026-10-14T00:00:00Z'), [ev('e9', 'supports', '2026-10-14T00:00:00Z')], since, now);
  assert.deepEqual([fresh!.isNew, fresh!.before], [true, null]);
});

test('one source counts once, as in the database view', () => {
  assert.equal(confidenceAt([ev('a1', 'supports', '2026-10-01T00:00:00Z', 's'), ev('a2', 'supports', '2026-10-01T00:00:00Z', 's')], now, 1e9).toFixed(3), (1 / 3).toFixed(3));
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('gate: the code\'s confidence equals the database view\'s, and a recorded answer reads as new', async () => {
  const user = await insertUser(db);
  const item = async (t: string) => (await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', $2) RETURNING id`, [user, t])).rows[0]!.id;
  const a = (await db.query<{ id: string }>(`SELECT record_answer($1::jsonb) AS id`, [JSON.stringify({ user_id: user, question_id: 6, answer: 'to build', derived_by: 'first_pass', derivation_key: 'k',
    evidence: [{ raw_content_id: await item('I want to build') }, { raw_content_id: await item('Building something of my own') }] })])).rows[0]!.id;
  const nowDb = new Date();
  const { moves } = await readAnswerMoves(user, supabase, nowDb);
  const view = Number((await db.query<{ c: string }>(`SELECT confidence AS c FROM answer_confidence WHERE answer_id = $1`, [a])).rows[0]!.c);
  assert.equal(moves.length, 1);
  assert.equal(moves[0]!.isNew, true);
  assert.ok(Math.abs(moves[0]!.after - view) < 0.006, `${moves[0]!.after} vs view ${view}`);
});
