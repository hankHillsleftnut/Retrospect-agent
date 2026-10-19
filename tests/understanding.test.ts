import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleUnderstanding, formatUnderstanding } from '../src/questions/understanding';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';

let db: PGlite;
before(async () => { ({ db } = await freshDatabase()); });

/** Gather exactly the rows loadUnderstanding reads, from real Postgres views. */
async function rowsFor(user: string) {
  const q = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows;
  return {
    coverage: await q(`SELECT domain_id, label, coverage, speak_coverage, may_speak FROM domain_coverage WHERE user_id = $1`, [user]),
    answers: await q(`SELECT id, question_id, answer, user_verdict, status FROM question_answers WHERE user_id = $1 AND status = 'active'`, [user]),
    questions: await q(`SELECT id, domain_id, text FROM canonical_questions`),
    domains: await q(`SELECT id, confidence_floor, position FROM question_domains`),
    scores: await q(`SELECT answer_id, confidence, independent_sources FROM answer_confidence WHERE user_id = $1`, [user]),
  };
}

async function quote(user: string, text: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', $2) RETURNING id`, [user, text],
  )).rows[0]!.id;
}

async function record(user: string, question: number, answer: string, texts: string[], key = `k-${question}-${answer}`) {
  const evidence = [];
  for (const t of texts) evidence.push({ raw_content_id: await quote(user, t) });
  return (await db.query<{ id: string }>(`SELECT record_answer($1::jsonb) AS id`, [JSON.stringify({
    user_id: user, question_id: question, answer, derived_by: 'first_pass', derivation_key: key, evidence,
  })])).rows[0]!.id;
}

test('a person we know nothing about: everything silent except how to speak to them', async () => {
  const user = await insertUser(db);
  const u = assembleUnderstanding(await rowsFor(user));
  assert.deepEqual(u.speaking.map((d) => d.domainId), ['speak']);
  assert.equal(u.silent.length, 7);
  const block = formatUnderstanding(u);
  assert.match(block, /no part of their life is understood well enough/);
  assert.match(block, /How they are \(0% understood; needs 80%\)/);
});

test('a domain that clears its bar is spoken; one that does not stays silent', async () => {
  const user = await insertUser(db);
  await record(user, 1, 'A product designer.', ['I work as a designer']);
  await record(user, 2, 'Building Retrospect.', ['Spent all day on Retrospect']);
  await record(user, 3, 'About six years.', ['six years of design work now']);
  await record(user, 27, 'Stretched thin.', ['I feel stretched thin']);

  const u = assembleUnderstanding(await rowsFor(user));
  const who = u.speaking.find((d) => d.domainId === 'who')!;
  assert.deepEqual(who.answers.map((a) => a.questionId), [1, 2, 3]);
  assert.ok(u.silent.some((s) => s.domainId === 'how'), '"how they are" needs far more than one quote');

  const block = formatUnderstanding(u);
  assert.match(block, /What do they do for work, concretely\? A product designer\. \(confidence 0\.33, 1 independent source\)/);
  assert.doesNotMatch(block, /Stretched thin/, 'never leaks an answer from a silent domain');
});

test('when the evidence is split, the writer is told to say so', async () => {
  const user = await insertUser(db);
  await record(user, 1, 'A product designer.', ['I work as a designer'], 'a');
  await record(user, 1, 'A founder.', ['I am a founder now'], 'b');
  await record(user, 2, 'Building Retrospect.', ['Spent all day on Retrospect']);
  await record(user, 3, 'About six years.', ['six years of design work now']);

  const block = formatUnderstanding(assembleUnderstanding(await rowsFor(user)));
  assert.match(block, /Evidence is split; it also supports: "A (founder|product designer)\."/);
});

test('a rejected answer is never spoken', async () => {
  const user = await insertUser(db);
  const id = await record(user, 1, 'A product designer.', ['I work as a designer']);
  await record(user, 2, 'Building Retrospect.', ['Spent all day on Retrospect']);
  await record(user, 3, 'About six years.', ['six years of design work now']);
  await db.query(`SELECT record_answer_verdict($1, $2, 'rejected')`, [user, id]);
  assert.doesNotMatch(formatUnderstanding(assembleUnderstanding(await rowsFor(user))), /product designer/);
});

test('no question store, no block: episode prompts are exactly as before', () => {
  assert.equal(formatUnderstanding(null), '');
});
