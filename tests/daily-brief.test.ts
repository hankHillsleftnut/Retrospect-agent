/** The daily brief: grounded, one through-line, quiet when nothing moved. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { vetBrief, buildBriefPrompt, type BriefMaterial, type BriefAnswer } from '../src/briefs/daily-brief';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { runDailyBrief } from '../src/briefs/run-daily-brief';

const NOTE = 'Named the first-offer pattern today. I keep taking the first job out of scarcity, and I go quiet when I feel inadequate.';
const material: BriefMaterial[] = [{ handle: 'M1', label: 'text entry · 2026-10-19', text: NOTE, quotable: NOTE, sourceRef: { raw_content_id: 'r1' } }];
const answers: BriefAnswer[] = [{ questionId: 31, question: 'What pattern is costing them most?', answer: 'Taking the first job out of scarcity.', confidence: 0.4, movedSince: 'strengthened' }];

test('an item quoting the material is kept, with why it is there', () => {
  const b = vetBrief({ spine_question_id: 31, spine_movement: 'complicates', through_line: 'A second pattern may sit underneath.',
    items: [{ text: 'You named going quiet.', why: 'a second pattern under the first', source: 'M1', quote: 'I go quiet when I feel inadequate' }] }, material, answers);
  assert.equal(b.kind, 'brief');
  assert.equal(b.items.length, 1);
  assert.equal(b.spineQuestionId, 31);
  assert.equal(b.items[0]!.sourceRef.raw_content_id, 'r1');
});

test('an invented quote is dropped; if nothing grounded is left, the brief is quiet, not invented', () => {
  const b = vetBrief({ spine_question_id: 31, through_line: 'x',
    items: [{ text: 'You felt ashamed.', why: 'y', source: 'M1', quote: 'I felt deeply ashamed about it all' }] }, material, answers);
  assert.equal(b.kind, 'quiet');
  assert.equal(b.dropped, 1);
});

test('a citation of material that was never shown is dropped', () => {
  const b = vetBrief({ spine_question_id: 31, through_line: 'x',
    items: [{ text: 't', why: 'w', source: 'M9', quote: 'I go quiet when I feel inadequate' }] }, material, answers);
  assert.equal(b.kind, 'quiet');
});

test('at most one aside', () => {
  const aside = { text: 'aside', why: null, source: 'M1', quote: 'Named the first-offer pattern today' };
  const b = vetBrief({ spine_question_id: 31, through_line: 'x', items: [
    { text: 'main', why: 'bears', source: 'M1', quote: 'I go quiet when I feel inadequate' }, aside, aside] }, material, answers);
  assert.equal(b.items.filter((i) => i.why === null).length, 1);
  assert.equal(b.dropped, 1);
});

test('a spine that is not one of their questions is not trusted', () => {
  const b = vetBrief({ spine_question_id: 99, through_line: 'x',
    items: [{ text: 't', why: 'w', source: 'M1', quote: 'I go quiet when I feel inadequate' }] }, material, answers);
  assert.equal(b.spineQuestionId, null);
});

test('the model saying "quiet" is respected', () => {
  assert.equal(vetBrief({ quiet: true, through_line: 'One word today: fun.' }, material, answers).kind, 'quiet');
});

test('em dashes never reach the person', () => {
  const b = vetBrief({ spine_question_id: 31, through_line: 'A pattern — underneath.',
    items: [{ text: 'You — named it.', why: 'w', source: 'M1', quote: 'I go quiet when I feel inadequate' }] }, material, answers);
  assert.equal(b.throughLine.includes('—'), false);
  assert.equal(b.items[0]!.text.includes('—'), false);
});

test('the prompt marks which answers moved', () => {
  assert.match(buildBriefPrompt(answers, material), /moved: strengthened/);
});

// ── Against a real database ─────────────────────────────────────────────────
let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('a day with nothing new makes a quiet brief without calling the model, and saves it', async () => {
  const userId = await insertUser(db);
  let called = false;
  const r = await runDailyBrief(userId, { model: async () => { called = true; return { data: {}, usage: { inputTokens: 0, outputTokens: 0 } }; } });
  assert.equal(called, false);
  assert.equal(r.brief.kind, 'quiet');
  assert.equal(r.costUsd, 0);
  const { rows } = await db.query<{ kind: string }>(`SELECT kind FROM daily_briefs WHERE user_id = $1`, [userId]);
  assert.deepEqual(rows, [{ kind: 'quiet' }]);
});

test('new writing becomes a grounded brief, saved once per day', async () => {
  const userId = await insertUser(db);
  await db.query(`INSERT INTO raw_content (user_id, content_type, content, authorship) VALUES ($1, 'text_entry', $2, 'self')`, [userId, NOTE]);
  const reply = { spine_question_id: 31, spine_movement: 'complicates', through_line: 'Underneath the first pattern, a second.',
    items: [{ text: 'You named going quiet.', why: 'a second pattern', source: 'M1', quote: 'I go quiet when I feel inadequate' }] };
  const model = async () => ({ data: reply, usage: { inputTokens: 1000, outputTokens: 200 } });
  await runDailyBrief(userId, { model });
  await runDailyBrief(userId, { model });
  const { rows } = await db.query<{ kind: string; n: number }>(`SELECT kind, jsonb_array_length(items) AS n FROM daily_briefs WHERE user_id = $1`, [userId]);
  assert.deepEqual(rows, [{ kind: 'brief', n: 1 }]);
});
