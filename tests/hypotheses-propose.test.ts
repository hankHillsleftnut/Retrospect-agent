/** F-H (goal 21): a model proposes; code decides what may exist. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { proposeHypotheses, storeHypotheses } from '../src/hypotheses/propose';
import type { UnderstandingContract } from '../src/understanding/read';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

const u = { inputTokens: 1, outputTokens: 1 };
const contract = {
  userId: 'u', asOf: '2026-10-20', silent: [{ domainId: 'how', label: 'How they are' }], goals: [], whys: [], shifts: [], time: { categories: [], otherShare: 0, weeksOfBaseline: 0 }, moves: { since: null, items: [] },
  answers: [
    { kind: 'answer', id: 'a1', questionId: 6, question: 'What pulls them?', domainId: 'want', answer: 'Making furniture', confidence: 0.8, sources: 3, confirmed: false, register: 'stated', lastMovedAt: null },
    { kind: 'answer', id: 'a2', questionId: 20, question: 'How are they?', domainId: 'how', answer: 'Tired', confidence: 0.8, sources: 3, confirmed: false, register: 'stated', lastMovedAt: null },
  ],
  patterns: [{ kind: 'pattern', id: 'p1', label: 'Loses track of time in the workshop', confidence: 0.8, instances: 4, firstSeenAt: null, lastSeenAt: null, trajectory: null, trajectoryDetail: null, register: 'stated' }],
} as unknown as UnderstandingContract;

const reply = (hypotheses: unknown[]) => async () => ({ data: { hypotheses } as never, usage: u });

test('valid proposals pass; clinical, thin, silent-domain and declined ones never exist', async () => {
  const r = await proposeHypotheses(contract, {
    sourcesOf: async (claims) => claims.length,
    declined: ['Is it the autonomy that pulls you?'],
    model: reply([
      { framework: 'flow', domain: 'want', question: 'Is the workshop where you are most absorbed?', rationale: 'r', supports: [1, 3] },
      { framework: 'sdt', domain: 'want', question: 'Could this be burnout?', supports: [1, 3] },
      { framework: 'sdt', domain: 'want', question: 'Is it the making itself?', supports: [3] },
      { framework: 'flow', domain: 'how', question: 'Are you most yourself there?', supports: [2, 3] },
      { framework: 'sdt', domain: 'want', question: 'Is it the autonomy that pulls you?', supports: [1, 3] },
    ]),
  });
  assert.deepEqual(r.valid.map((v) => v.question), ['Is the workshop where you are most absorbed?']);
  assert.deepEqual(r.rejected.map((x) => x.why), ['clinical', 'too little evidence', 'domain not ready', 'already declined']);
});

test('a reply that fails twice proposes nothing', async () => {
  const r = await proposeHypotheses(contract, { sourcesOf: async () => 2, model: async () => { throw new Error('bad json'); } });
  assert.equal(r.valid.length, 0);
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('stored once, with its framework and evidence; the same question is not stored twice', async () => {
  const user = await insertUser(db);
  const p = { framework: 'flow' as const, domainId: 'want', question: 'Is the workshop where you are most absorbed?', rationale: 'r', supports: [{ kind: 'pattern' as const, id: 'p1' }, { kind: 'answer' as const, id: 'a1' }], sources: 2 };
  assert.equal(await storeHypotheses(user, [p]), 1);
  assert.equal(await storeHypotheses(user, [p]), 0);
  const row = (await db.query<{ framework: string; status: string; supports: unknown[] }>(`SELECT framework, status, supports FROM hypotheses WHERE user_id = $1`, [user])).rows[0]!;
  assert.equal(row.framework, 'flow');
  assert.equal(row.status, 'stored');
  assert.equal(row.supports.length, 2);
});
