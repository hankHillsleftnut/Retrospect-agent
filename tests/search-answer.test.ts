/** S1.2: "here's what we found", with sources below; abstains; every claim checked against what it cites. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citations, mergeHits, searchAndAnswer } from '../src/search/answer';
import type { SearchHit } from '../src/search/search';

const hit = (id: string, score: number, snippet = id): SearchHit => ({ kind: 'item', id, snippet, happened_at: '2026-10-01T00:00:00Z', score });
const u = { inputTokens: 1, outputTokens: 1 };

test('citations come off the sentence; merged hits keep each item once, best score', () => {
  assert.deepEqual(citations('You want to raise money [2][4].'), { text: 'You want to raise money.', cites: [2, 4] });
  assert.deepEqual(mergeHits([[hit('a', 0.1), hit('b', 0.3)], [hit('a', 0.5)]]).map((h) => [h.id, h.score]), [['a', 0.5], ['b', 0.3]]);
});

test('the rewritten searches are run too, and the synthesis keeps only what its sources support', async () => {
  const asked: string[] = [];
  const r = await searchAndAnswer('u', 'what am I afraid of', {
    search: async (q) => { asked.push(q); return q === 'fear' ? [hit('n1', 0.4, 'My fear is running out of money.')] : []; },
    rewrite: async () => ({ data: { queries: ['fear', 'worried'] }, usage: u }),
    write: async () => ({ data: { abstain: false, sentences: ['You wrote that your fear is running out of money [1].', 'You are terrified of failing [1].'] }, usage: u }),
    guard: async (_s, p) => ({ data: { sentences: p.split('SENTENCE ').slice(1).map((c, i) => ({ i, claims: c.includes('terrified') ? [{ claim: 'terrified of failing', supported: false }] : [], isQuestion: false })) }, usage: u }),
  });
  assert.deepEqual(asked, ['what am I afraid of', 'fear', 'worried']);
  assert.equal(r.summary, 'You wrote that your fear is running out of money [1].');
  assert.equal(r.cut.length, 1);
  assert.deepEqual(r.sources.map((s) => [s.n, s.id, s.date]), [[1, 'n1', '2026-10-01']]);
});

test('nothing found, or nothing that answers it: it says so plainly', async () => {
  const none = await searchAndAnswer('u', 'zebra', { search: async () => [], rewrite: async () => ({ data: { queries: [] }, usage: u }) });
  assert.deepEqual([none.abstained, none.summary], [true, 'Nothing in your bank speaks to this yet.']);
  const no = await searchAndAnswer('u', 'q', { search: async () => [hit('x', 0.1)], rewrite: async () => ({ data: {}, usage: u }), write: async () => ({ data: { abstain: true, why: 'Your notes mention it but never say.' }, usage: u }) });
  assert.deepEqual([no.abstained, no.summary, no.sources.length], [true, 'Your notes mention it but never say.', 1], 'sources still shown');
});
