/** W6.2: typed outline from the plan; every sentence guarded against its own section. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outlineFromPlan, writeEpisode, scriptText, factLines } from '../src/writer/write-episode';
import type { EpisodePlan } from '../src/planner/plan';

const plan: EpisodePlan = {
  spine: null,
  items: [
    { id: 'pattern:gym', kind: 'pattern', register: 'stated', facts: { label: 'skips the gym', instances: 9, trajectory: 'weakening', counts: { prior: 6, recent: 1 } }, evidence: ['gym'] },
    { id: 'shift:health:steps', kind: 'shift', register: 'stated', facts: { what: 'steps', direction: 'up', thisWeek: 5006, usual: 2566, days: 5 }, evidence: ['h1'] },
  ],
  reflection: { whyId: 'w1', patternId: 'gym', mechanism: 'avoidance' },
  withheld: [], silent: [],
};
plan.spine = plan.items[0]!;

test('gate (goal 13): the outline is typed, in order, and every section carries its evidence', () => {
  const o = outlineFromPlan(plan);
  assert.deepEqual(o.map((s) => [s.id, s.role, s.register]), [['pattern:gym', 'spine', 'stated'], ['shift:health:steps', 'item', 'stated'], ['why:w1', 'question', 'asked']]);
  assert.ok(o.every((s) => s.facts.length > 0));
  assert.match(factLines(plan.items[0]!).join(' '), /6 times in the four weeks before, 1 in the last four/);
});

test('sentences the guard rejects are cut and counted; the rest make the script', async () => {
  const e = await writeEpisode(plan, {
    asOf: '2026-10-20',
    writer: async () => ({ data: { title: 'A quieter gym habit', sections: [
      { id: 'pattern:gym', sentences: ['Six times last month, once this month.', 'You must feel proud.'] },
      { id: 'shift:health:steps', sentences: ['Your steps nearly doubled this week.'] },
      { id: 'why:w1', sentences: ['I wonder whether the gym was something to avoid.'] },
    ] }, usage: { inputTokens: 10, outputTokens: 10 } }),
    guard: async (_s, prompt) => ({ data: { sentences: prompt.split('SENTENCE ').slice(1).map((chunk, i) => ({
      i, claims: chunk.includes('proud') ? [{ claim: 'feels proud', supported: false }] : [], isQuestion: chunk.includes('wonder'),
    })) }, usage: { inputTokens: 5, outputTokens: 5 } }),
  });
  assert.deepEqual({ ...e.stats, words: undefined }, { sentences: 4, kept: 3, cut: 1, sectionsWithEvidence: 3, sections: 3, words: undefined });
  assert.equal(e.sections[0]!.cut[0]!.reason, 'not in the evidence: feels proud');
  assert.ok(!scriptText(e).includes('proud'));
});

test('W6.3: a woven script keeps spoken order; a "craft" line that claims something about the listener is cut', async () => {
  const e = await writeEpisode(plan, {
    asOf: '2026-10-20', style: 'medium',
    writer: async () => ({ data: { title: 't', sentences: [
      { section: 'craft', text: 'Let me start somewhere small.' },
      { section: 'pattern:gym', text: 'Six times last month, once this month.' },
      { section: 'craft', text: 'You have clearly found your discipline.' },
      { section: 'nonsense', text: 'And your steps doubled.' },
    ] }, usage: { inputTokens: 1, outputTokens: 1 } }) as never,
    guard: async (_s, prompt) => ({ data: { sentences: prompt.split('SENTENCE ').slice(1).map((chunk, i) => ({
      i, claims: /discipline|steps/.test(chunk) && !/EVIDENCE \d+:\n- A recurring/.test(chunk) ? [{ claim: 'x', supported: false }] : [], isQuestion: false,
    })) }, usage: { inputTokens: 1, outputTokens: 1 } }),
  });
  assert.deepEqual(e.sections.map((s) => s.id), ['craft', 'pattern:gym', 'craft']);
  assert.equal(e.stats.cut, 2, 'the unsupported craft line and the unknown-section line');
});
