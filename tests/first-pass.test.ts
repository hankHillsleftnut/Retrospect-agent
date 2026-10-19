import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vetFirstPass, buildFirstPassPrompt, type PoolItem, type Question } from '../src/questions/first-pass';
import { runFirstPass } from '../src/questions/run-first-pass';

const JOURNAL = 'Honestly I want to build something of my own. I keep thinking about leaving Sentra.';

const pool: PoolItem[] = [
  { handle: 'E1', ref: { raw_content_id: 'raw-1' }, ownWords: true, label: 'journal · 2026-06-09', text: JOURNAL, quotable: JOURNAL },
  { handle: 'E2', ref: { raw_content_id: 'raw-2' }, ownWords: false, label: 'healthkit · 2026-06-09', text: 'Steps: 480\nSleep: not recorded' },
  { handle: 'E3', ref: { assertion_id: 'fact-3' }, ownWords: true, label: 'fact from journal entry', text: 'works at: Sentra' },
];

const q = (id: number, extra: Partial<Question> = {}): Question => ({
  id, domainId: 'want', text: `question ${id}`, requiresOwnWords: false, hypothesisOnly: false, ...extra,
});

test('a guess citing their exact words is kept, with the quote as its excerpt', () => {
  const [o] = vetFirstPass([q(6, { requiresOwnWords: true })], pool, {
    answers: [{ question: 6, answer: 'To build their own company.', evidence: [{ handle: 'E1', quote: 'I want to build something of my own' }] }],
  });
  assert.equal(o!.status, 'guessed');
  assert.deepEqual(o!.status === 'guessed' && o!.guess.evidence, [
    { raw_content_id: 'raw-1', stance: 'supports', excerpt: 'I want to build something of my own' },
  ]);
});

test('a paraphrased quote is discarded, and so is the guess it was holding up', () => {
  const [o] = vetFirstPass([q(6, { requiresOwnWords: true })], pool, {
    answers: [{ question: 6, answer: 'To start a company.', evidence: [{ handle: 'E1', quote: 'I want to start my own company' }] }],
  });
  assert.equal(o!.status, 'unsupported');
  assert.deepEqual(o!.dropped, [{ handle: 'E1', reason: 'quote_not_found' }]);
});

test('an item the model was never shown cannot be cited', () => {
  const [o] = vetFirstPass([q(7)], pool, {
    answers: [{ question: 7, answer: 'Work.', evidence: [{ handle: 'E99' }] }],
  });
  assert.equal(o!.status, 'unsupported');
  assert.equal(o!.dropped[0]!.reason, 'unknown_handle');
});

test('a feeling cannot rest on a step count', () => {
  const [o] = vetFirstPass([q(27, { requiresOwnWords: true })], pool, {
    answers: [{ question: 27, answer: 'Depleted.', evidence: [{ handle: 'E2' }] }],
  });
  assert.equal(o!.status, 'unsupported');
});

test("the model's own confidence is ignored", () => {
  const [o] = vetFirstPass([q(1)], pool, {
    answers: [{ question: 1, answer: 'Works at Sentra.', confidence: 0.99, evidence: [{ handle: 'E3' }] }],
  });
  assert.equal(o!.status, 'guessed');
  assert.equal('confidence' in (o as any).guess, false);
});

test('"no basis" is an honest answer and is recorded as such', () => {
  const [o] = vetFirstPass([q(25)], pool, { answers: [{ question: 25, answer: null, no_basis: true }] });
  assert.equal(o!.status, 'no_basis');
});

test('hypothesis-only questions are left to the hypothesis engine', () => {
  const [o] = vetFirstPass([q(10, { hypothesisOnly: true })], pool, {
    answers: [{ question: 10, answer: 'Secretly wants recognition.', evidence: [{ handle: 'E1', quote: 'build something' }] }],
  });
  assert.equal(o!.status, 'gated');
});

test('contradicting evidence is kept, not hidden', () => {
  const [o] = vetFirstPass([q(1)], pool, {
    answers: [{ question: 1, answer: 'Full-time founder.', evidence: [
      { handle: 'E1', quote: 'I want to build something of my own' },
      { handle: 'E3', stance: 'contradicts' },
    ] }],
  });
  assert.equal(o!.status === 'guessed' && o!.guess.evidence[1]!.stance, 'contradicts');
});

test('the prompt marks which items are their words and which questions need them', () => {
  const prompt = buildFirstPassPrompt('What they want', [q(6, { requiresOwnWords: true })], pool);
  assert.match(prompt, /E1 · THEIR WORDS/);
  assert.match(prompt, /E2 · RECORD/);
  assert.match(prompt, /6\. question 6 {2}\[OWN WORDS ONLY\]/);
});

// ── The whole run, with a fake database and model ───────────────────────────

/** Answers every query from fixed tables; records rpc calls. */
function fakeDb(tables: Record<string, any[]>, rpcError: (p: any) => string | null = () => null) {
  const rpc: any[] = [];
  const db = {
    from(table: string) {
      const chain: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') return (res: any) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(res);
          return () => chain;
        },
      });
      return chain;
    },
    async rpc(_fn: string, args: any) {
      rpc.push(args.p);
      const msg = rpcError(args.p);
      return { data: msg ? null : 'answer-id', error: msg ? { message: msg } : null };
    },
  };
  return { db: db as any, rpc };
}

test('a full run records each surviving guess once, through the one way in', async () => {
  const { db, rpc } = fakeDb(
    {
      canonical_questions: [
        { id: 6, domain_id: 'want', text: 'What have they said they want?', requires_own_words: true, hypothesis_only: false },
        { id: 10, domain_id: 'want', text: 'Unnamed wants?', requires_own_words: false, hypothesis_only: true },
        { id: 27, domain_id: 'how', text: 'How are they doing?', requires_own_words: true, hypothesis_only: false },
      ],
      question_domains: [{ id: 'want', label: 'What they want' }, { id: 'how', label: 'How they are' }],
      raw_content: [{ id: 'raw-1', content_type: 'journal_entry', content: JOURNAL, created_at: '2026-06-09' }],
    },
    (p) => (p.question_id === 27 ? 'record_answer: needs own words' : null),
  );
  const calls: string[] = [];
  const report = await runFirstPass('u1', {
    db,
    modelName: 'test-model',
    model: async (_system, user) => {
      calls.push(user.split('\n')[0]!);
      const handle = /(E\d+) · THEIR WORDS/.exec(user)![1];
      const question = user.includes('How they are') ? 27 : 6;
      return {
        data: { answers: [{ question, answer: 'A guess.', evidence: [{ handle, quote: 'I want to build something' }] }] },
        usage: { inputTokens: 1000, outputTokens: 100 },
      };
    },
  });

  assert.deepEqual(calls, ['# Part of their life: What they want', '# Part of their life: How they are'], 'one call per domain');
  assert.equal(rpc.length, 2);
  assert.equal(rpc[0].derivation_key, 'first_pass:q6');
  assert.equal(rpc[0].derived_by, 'first_pass');
  assert.equal(report.recorded, 1);
  assert.deepEqual(report.refusedByDatabase, [{ questionId: 27, reason: 'record_answer: needs own words' }]);
  assert.equal(report.byStatus.gated, 1, 'question 10 was not attempted');
  assert.ok(report.costUsd > 0, 'cost is reported, not hidden');
});

test('a person with nothing on record gets no guesses and costs nothing', async () => {
  const { db, rpc } = fakeDb({
    canonical_questions: [{ id: 6, domain_id: 'want', text: 'q', requires_own_words: true, hypothesis_only: false }],
    question_domains: [{ id: 'want', label: 'What they want' }],
  });
  let called = false;
  const report = await runFirstPass('u1', { db, model: async () => { called = true; return { data: {}, usage: { inputTokens: 0, outputTokens: 0 } }; } });
  assert.equal(called, false);
  assert.equal(rpc.length, 0);
  assert.equal(report.byStatus.not_returned, 1);
});

test('the model is told not to assume pronouns or leak item handles into answers', async () => {
  const { FIRST_PASS_SYSTEM } = await import('../src/questions/first-pass.js');
  const { RESEARCH_SYSTEM } = await import('../src/questions/research.js');
  for (const prompt of [FIRST_PASS_SYSTEM, RESEARCH_SYSTEM]) {
    assert.match(prompt, /as "they" unless their own words state their pronouns/);
    assert.match(prompt, /Never mention item handles/);
  }
});
