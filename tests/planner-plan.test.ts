/** W5.2: from the read contract to an episode plan. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEpisode } from '../src/planner/plan';
import type { UnderstandingContract } from '../src/understanding/read';

const contract = (over: Partial<UnderstandingContract> = {}): UnderstandingContract => ({
  userId: 'u', asOf: '2026-10-20', answers: [], silent: [{ domainId: 'how', label: 'How they are' }],
  patterns: [], whys: [], goals: [], shifts: [], time: { categories: [], otherShare: 0, weeksOfBaseline: 4 },
  moves: { since: null, items: [] }, ...over,
});
const pattern = (id: string, confidence: number, trajectory: 'weakening' | 'insufficient' = 'insufficient') =>
  ({ kind: 'pattern' as const, id, label: id, confidence, instances: 5, firstSeenAt: null, lastSeenAt: null, trajectory, trajectoryDetail: { prior: 6, recent: 1 }, register: 'stated' as const });

test('a quiet week plans nothing and asks nothing', () => {
  const p = planEpisode(contract({ patterns: [pattern('p', 0.2)] }));
  assert.deepEqual([p.items.length, p.reflection, p.spine], [0, null, null]);
  assert.deepEqual(p.silent, ['How they are']);
});

test('a weakening pattern leads; its provisional why becomes the one asked question', () => {
  const p = planEpisode(contract({
    patterns: [pattern('gym', 0.6, 'weakening'), pattern('late', 0.65)],
    whys: [{ kind: 'why', id: 'w-late', patternId: 'late', mechanism: 'capacity', confidence: 0.9, register: 'asked', provisional: true },
           { kind: 'why', id: 'w-gym', patternId: 'gym', mechanism: 'avoidance', confidence: 0.4, register: 'asked', provisional: true }],
  }));
  assert.equal(p.spine?.id, 'pattern:gym', 'moved beats slightly stronger');
  assert.equal(p.reflection?.whyId, 'w-gym', 'the why behind the spine, even if a less confident one');
});

test('answers keep the register the contract gave them; shifts are stated with their numbers and evidence', () => {
  const p = planEpisode(contract({
    answers: [{ kind: 'answer', id: 'a', questionId: 7, question: 'q', domainId: 'who', answer: 'x', confidence: 0.5, sources: 2, confirmed: false, register: 'asked', lastMovedAt: null }],
    shifts: [{ domain: 'health', metric: 'steps', label: 'steps', direction: 'up', recentMedian: 5006, baselineMedian: 2566, change: 0.95, p: 0.034, recentDays: 5, baselineDays: 25, sourceIds: ['h1'] }],
  }));
  const byKind = Object.fromEntries(p.items.map((i) => [i.kind, i]));
  assert.equal(byKind.answer!.register, 'asked');
  assert.deepEqual([byKind.shift!.facts.thisWeek, byKind.shift!.evidence], [5006, ['h1']]);
});

test('three lenses: many strong patterns do not crowd out a shift, a goal and content', () => {
  const p = planEpisode(contract({
    patterns: Array.from({ length: 8 }, (_, i) => pattern(`p${i}`, 0.85)),
    shifts: [{ domain: 'health', metric: 'steps', label: 'steps', direction: 'up', recentMedian: 5006, baselineMedian: 2566, change: 0.95, p: 0.03, recentDays: 5, baselineDays: 25, sourceIds: [] }],
  }), {
    saidVsDid: [{ goalId: 'g', title: 'g', said: { statedAt: '2026-06-01', lastMentionedAt: null }, did: { hoursThisWeek: 7, hoursUsualWeek: 0, events: 3, contentItems: 1, patterns: [] }, evidence: ['e'] }],
    content: [{ itemIds: ['a', 'b', 'c', 'd', 'e', 'f'], titles: [], goalIds: [], label: 'woodworking' }],
  });
  const kinds = new Set(p.items.map((i) => i.kind));
  assert.ok(kinds.has('shift') && kinds.has('said_vs_did') && kinds.has('content'), [...kinds].join(','));
  assert.ok(p.items.filter((i) => i.kind === 'pattern').length >= 2);
});

test('an "unclear" why is never the asked question', () => {
  const p = planEpisode(contract({ patterns: [pattern('gym', 0.7, 'weakening')], whys: [{ kind: 'why', id: 'w', patternId: 'gym', mechanism: 'unclear', confidence: 0.9, register: 'asked', provisional: true }] }));
  assert.equal(p.reflection, null);
});
