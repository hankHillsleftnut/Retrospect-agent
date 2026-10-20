/** D1.3: the daily brief's sections and its guard. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefSections, writeBrief } from '../src/writer/write-brief';
import type { DailyPlan } from '../src/planner/daily';

const plan: DailyPlan = {
  inbox: [{ id: 'n1', contentType: 'text_entry', at: '2026-10-20T08:00:00Z', preview: 'Essay on seed rounds https://x.com/a', url: 'https://x.com/a' }],
  today: [{ id: 'e1', title: 'Investor call', start: '2026-10-20T10:00:00-07:00', end: '2026-10-20T10:30:00-07:00', withOthers: 2 }],
  items: [], withheld: [], quiet: false,
};

test('sections run inbox, today, then items; what was sent carries the goals as its only ground for a reason', () => {
  const s = briefSections(plan, { goals: ['Raise a seed round'], answers: [] });
  assert.deepEqual(s.map((x) => x.id), ['inbox:n1', 'today']);
  assert.ok(s[0]!.facts.some((f) => f.includes('A goal they stated: Raise a seed round')));
  assert.match(s[1]!.facts[0]!, /Investor call" at 10:00-10:30, with 2 other/);
});

test('an invented reason is cut; a reason from a stated goal stays', async () => {
  const sections = briefSections(plan, { goals: ['Raise a seed round'], answers: [] });
  const b = await writeBrief(sections, {
    asOf: '2026-10-20',
    writer: async () => ({ data: { title: 't', sentences: [
      { section: 'inbox:n1', text: 'You sent an essay on seed rounds, useful for the round you said you want to raise.' },
      { section: 'inbox:n1', text: 'You have been anxious about money all week.' },
    ] }, usage: { inputTokens: 1, outputTokens: 1 } }),
    guard: async (_s, prompt) => ({ data: { sentences: prompt.split('SENTENCE ').slice(1).map((chunk, i) => ({ i, claims: chunk.includes('anxious') ? [{ claim: 'anxious about money', supported: false }] : [], isQuestion: false })) }, usage: { inputTokens: 1, outputTokens: 1 } }),
  });
  assert.equal(b.kept, 1);
  assert.equal(b.cut[0]!.reason, 'not in the evidence: anxious about money');
});
