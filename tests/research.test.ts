import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolItem, Question } from '../src/questions/first-pass';
import { readUpTo } from '../src/questions/run-research';
import {
  rankNewItems, mergeEvidence, pickQuestions, researchDerivationKey, researchPool, vetResearch,
  type CurrentAnswer, type QuestionState,
} from '../src/questions/research';
import { runResearch } from '../src/questions/run-research';

const q = (id: number, extra: Partial<Question> = {}): Question => ({
  id, domainId: 'want', text: `question ${id}`, requiresOwnWords: false, hypothesisOnly: false, ...extra,
});
const item = (n: number, text: string, ownWords = true, at = `2026-10-1${n}`): PoolItem => ({
  handle: '', ref: { raw_content_id: `raw-${n}` }, ownWords, label: `journal · ${at}`, text,
  ...(ownWords ? { quotable: text } : {}), at,
});
const answered = (confidence: number, evidence: CurrentAnswer['evidence'] = []): CurrentAnswer => ({
  answerId: 'a1', derivationKey: 'first_pass:q6', derivedBy: 'first_pass', answer: 'Wants to start a company.',
  confidence, evidence,
});
const state = (question: Question, current: CurrentAnswer | null, newItems: PoolItem[], floor = 0.6): QuestionState => ({
  question, floor, current, competing: current ? 1 : 0, newItems,
});

// ── Which questions get a look ──────────────────────────────────────────────

test('nothing new, nothing researched -- re-reading old material can only cost money', () => {
  assert.deepEqual(pickQuestions([state(q(6), answered(0.2), [])]), []);
});

test('unanswered first, then the furthest below its bar, then the confident', () => {
  const fresh = [item(1, 'something new happened today')];
  const picked = pickQuestions([
    state(q(1), answered(0.9), fresh),
    state(q(2), answered(0.1), fresh),
    state(q(3), null, fresh),
    state(q(4), answered(0.5), fresh),
  ]);
  assert.deepEqual(picked.map((s) => s.question.id), [3, 2, 4, 1]);
});

test('hypothesis-only questions are not researched here', () => {
  assert.deepEqual(pickQuestions([state(q(10, { hypothesisOnly: true }), null, [item(1, 'something new')])]), []);
});

test('the daily budget is respected', () => {
  const many = Array.from({ length: 20 }, (_, i) => state(q(i + 1), null, [item(1, 'new material here')]));
  assert.equal(pickQuestions(many, 6).length, 6);
});

// ── What survives ───────────────────────────────────────────────────────────

const OLD = 'I want to start my own company one day.';
const NEW_FOR = 'Spent the whole weekend on the pitch deck for my startup.';
const NEW_AGAINST = 'Honestly I think I am happy staying at Sentra for now.';

function withPool() {
  const s = state(q(6, { requiresOwnWords: true }), answered(0.33, [{ ...item(0, OLD, true, '2026-09-01'), stance: 'supports', excerpt: OLD }]),
    [item(1, NEW_FOR), item(2, NEW_AGAINST)]);
  return { s, pool: researchPool(s) };
}

test('new supporting evidence strengthens the current answer', () => {
  const { s, pool } = withPool();
  const action = vetResearch(s, pool, { verdict: 'update', evidence: [{ handle: 'E2', quote: 'pitch deck for my startup' }] });
  assert.equal(action.kind, 'update');
  assert.equal(action.kind === 'update' && action.outcome, 'strengthened');
});

test('new contrary evidence weakens it, and is kept', () => {
  const { s, pool } = withPool();
  const action = vetResearch(s, pool, { verdict: 'update', evidence: [{ handle: 'E3', quote: 'happy staying at Sentra', stance: 'contradicts' }] });
  assert.equal(action.kind === 'update' && action.outcome, 'weakened');
});

test('re-citing what the answer already rests on does not count twice', () => {
  const { s, pool } = withPool();
  const action = vetResearch(s, pool, { verdict: 'update', evidence: [{ handle: 'E1', quote: 'start my own company' }] });
  assert.equal(action.kind, 'unsupported');
});

test('a revised answer is a new, competing answer, not an overwrite', () => {
  const { s, pool } = withPool();
  const action = vetResearch(s, pool, {
    verdict: 'revise', answer: 'Content where they are, for now.',
    evidence: [{ handle: 'E3', quote: 'happy staying at Sentra' }],
  });
  assert.equal(action.kind, 'revise');
  assert.notEqual(researchDerivationKey(6, 'Content where they are, for now.'), s.current!.derivationKey);
});

test('a revision still has to quote them exactly', () => {
  const { s, pool } = withPool();
  const action = vetResearch(s, pool, {
    verdict: 'revise', answer: 'Content at Sentra.', evidence: [{ handle: 'E3', quote: 'quite happy at Sentra' }],
  });
  assert.equal(action.kind, 'unsupported');
});

test('updated evidence keeps what the answer had and adds what is new', () => {
  const { s } = withPool();
  const merged = mergeEvidence(s.current!, [{ raw_content_id: 'raw-1', stance: 'supports', excerpt: 'pitch deck' }]);
  assert.deepEqual(merged.map((e: any) => e.raw_content_id), ['raw-0', 'raw-1']);
});

// ── The whole run ───────────────────────────────────────────────────────────

function fakeDb(tables: Record<string, any[]>) {
  const rpc: any[] = [];
  const inserts: { table: string; row: any }[] = [];
  const db = {
    from(table: string) {
      const chain: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') return (res: any) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(res);
          if (prop === 'insert') return (row: any) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); };
          return () => chain;
        },
      });
      return chain;
    },
    async rpc(_fn: string, args: any) { rpc.push(args.p); return { data: 'a1', error: null }; },
  };
  return { db: db as any, rpc, inserts };
}

test('a run strengthens an answer, saves through the one way in, and logs what it read', async () => {
  const { db, rpc, inserts } = fakeDb({
    canonical_questions: [{ id: 6, domain_id: 'want', text: 'What have they said they want?', requires_own_words: true, hypothesis_only: false }],
    question_domains: [{ id: 'want', label: 'What they want', confidence_floor: 0.6 }],
    current_answers: [{ question_id: 6, answer_id: 'a1', answer: 'Wants to start a company.', confidence: 0.33, competing_answers: 1 }],
    question_answers: [{ id: 'a1', derivation_key: 'first_pass:q6', derived_by: 'first_pass' }],
    answer_evidence: [{ answer_id: 'a1', stance: 'supports', raw_content_id: 'raw-0', kind_id: 'journal', excerpt: OLD, observed_at: '2026-09-01' }],
    evidence_kinds: [{ id: 'journal', label: 'Journal', own_words: true }],
    // Every raw_content query returns these; raw-0 is the cited one and is
    // excluded from "new" because the answer already rests on it.
    raw_content: [
      { id: 'raw-0', content_type: 'journal_entry', content: OLD, created_at: '2026-09-01T00:00:00Z' },
      { id: 'raw-1', content_type: 'journal_entry', content: NEW_FOR, created_at: '2026-10-17T00:00:00Z' },
    ],
  });

  const result = await runResearch('u1', {
    db, modelName: 'test-model',
    model: async (_s, user) => {
      const handle = /(E\d+) · THEIR WORDS · journal entry/.exec(user.split('## New since last looked')[1]!)![1];
      return { data: { verdict: 'update', evidence: [{ handle, quote: 'pitch deck for my startup' }] }, usage: { inputTokens: 2000, outputTokens: 50 } };
    },
  });

  assert.deepEqual(result.researched.map((r) => r.outcome), ['strengthened']);
  assert.equal(rpc[0].derivation_key, 'first_pass:q6', 'same answer, not a new one');
  assert.equal(rpc[0].derived_by, 'first_pass', 'provenance kept');
  assert.deepEqual(rpc[0].evidence.map((e: any) => e.raw_content_id), ['raw-0', 'raw-1']);
  const log = inserts.find((i) => i.table === 'question_research_log')!.row;
  assert.equal(log.outcome, 'strengthened');
  assert.equal(log.material_until, '2026-10-17T00:00:00Z', 'next time starts after what it read');
  assert.ok(result.costUsd > 0);
});

test('a failed look is logged without moving past the material, so it is retried', async () => {
  const { db, rpc, inserts } = fakeDb({
    canonical_questions: [{ id: 6, domain_id: 'want', text: 'q', requires_own_words: true, hypothesis_only: false }],
    question_domains: [{ id: 'want', label: 'x', confidence_floor: 0.6 }],
    raw_content: [{ id: 'raw-1', content_type: 'journal_entry', content: NEW_FOR, created_at: '2026-10-17T00:00:00Z' }],
  });
  const result = await runResearch('u1', { db, model: async () => { throw new Error('overloaded'); } });
  assert.equal(result.researched[0]!.outcome, 'failed');
  assert.equal(rpc.length, 0);
  assert.equal(inserts[0]!.row.material_until, new Date(0).toISOString());
});

// ── Routing new items by source (19 October 2026) ───────────────────────────

const routed = (id: string, contentType: string | undefined, at: string, ownWords = false) =>
  ({ id, contentType, at, ownWords });

test('a calendar question sees calendar items first, even when other items are newer', () => {
  const items = [
    routed('yt1', 'youtube', '2026-10-19T21:17:00Z'),
    routed('cal1', 'calendar', '2026-10-19T21:16:00Z'),
    routed('mail1', 'gmail', '2026-10-19T21:16:30Z'),
    routed('cal2', 'calendar', '2026-10-19T21:16:10Z'),
  ];
  assert.deepEqual(rankNewItems(items, ['calendar'], 3).map((i) => i.id), ['cal2', 'cal1', 'yt1']);
});

test('"words" means the person\'s own words, whatever the type', () => {
  const items = [
    routed('fact-from-mail', 'gmail', '2026-10-19T21:17:00Z'),
    routed('journal', 'journal_entry', '2026-10-01T09:00:00Z', true),
  ];
  assert.deepEqual(rankNewItems(items, ['words'], 1).map((i) => i.id), ['journal']);
});

test('a question with no listed sources keeps plain newest-first order', () => {
  const items = [routed('a', 'gmail', '2026-10-01T00:00:00Z'), routed('b', 'calendar', '2026-10-02T00:00:00Z')];
  assert.deepEqual(rankNewItems(items, [], 2).map((i) => i.id), ['b', 'a']);
});

test('the limit still holds', () => {
  const items = Array.from({ length: 60 }, (_, n) => routed(`c${n}`, 'calendar', `2026-10-19T21:${String(n % 60).padStart(2, '0')}:00Z`));
  assert.equal(rankNewItems(items, ['calendar'], 40).length, 40);
});

test('when everything new was shown, the look counts up to the newest item', () => {
  const now = new Date('2026-10-19T22:00:00Z');
  assert.equal(readUpTo([{ at: '2026-10-19T21:16:00Z' }, { at: '2026-10-19T21:17:00Z' }], null, now), '2026-10-19T21:17:00Z');
});

test('items that did not fit are not skipped: the look stops just before the earliest unshown one', () => {
  const now = new Date('2026-10-19T22:00:00Z');
  assert.equal(
    readUpTo([{ at: '2026-10-19T21:17:00Z' }], '2026-10-19T21:16:00.000Z', now),
    '2026-10-19T21:15:59.999Z',
  );
});

test('two fitting sources take turns, so a burst of one cannot crowd out the other', () => {
  const items = [
    ...Array.from({ length: 5 }, (_, n) => routed(`mail${n}`, 'gmail', `2026-10-19T21:17:0${n}Z`)),
    routed('cal1', 'calendar', '2026-10-19T21:16:00Z'),
    routed('cal2', 'calendar', '2026-10-19T21:16:01Z'),
  ];
  assert.deepEqual(
    rankNewItems(items, ['calendar', 'mail'], 4).map((i) => i.id),
    ['cal2', 'mail4', 'cal1', 'mail3'],
  );
});
