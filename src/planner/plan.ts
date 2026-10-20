/**
 * From what the brain knows to what this episode says (W5.2).
 *
 * Turns the read contract (W4) into planner candidates with strengths that
 * are COUNTED, never a model's opinion, runs the selection (W5.1), and adds
 * at most one asked question (founder, 19 Oct: one provisional why per
 * episode, always asked). Declared before running on anyone's data:
 *   pattern      strength = its confidence; moved when its trajectory changed
 *   answer       strength = counted confidence; moved when it moved since the
 *                last episode; register from the contract (stated / asked)
 *   shift        0.6 (passed its test and the 25% bar); always moved
 *   said vs did  0.5 for a goal with any activity; goal-linked
 *   content      0.4 + 0.05 per item, at most 0.7
 * Silent domains never contribute. Every item carries its evidence ids.
 */

import type { UnderstandingContract, Register } from '../understanding/read';
import type { SaidVsDid } from '../understanding/said-vs-did';
import type { ContentGroup } from '../understanding/content-groups';
import { selectItems, type PlanCandidate } from './select';

export interface PlanItem {
  id: string;
  kind: 'pattern' | 'answer' | 'shift' | 'said_vs_did' | 'content';
  register: Register;
  /** What the writer may say, as data: never prose to be repeated as fact. */
  facts: Record<string, unknown>;
  evidence: string[];
}

export interface EpisodePlan {
  spine: PlanItem | null;
  items: PlanItem[];
  /** One question, asked, never stated; null when none has been earned. */
  reflection: { whyId: string; patternId: string; mechanism: string } | null;
  withheld: Array<{ id: string; why: string }>;
  silent: string[];
}

interface Built { candidate: PlanCandidate; item: PlanItem }

export function buildCandidates(c: UnderstandingContract, extras: { saidVsDid?: SaidVsDid[]; content?: ContentGroup[] } = {}): Built[] {
  const moved = new Set(c.moves.items.map((m) => m.answerId));
  const out: Built[] = [];
  for (const p of c.patterns) {
    const changed = p.trajectory === 'weakening' || p.trajectory === 'strengthening';
    out.push({
      candidate: { id: `pattern:${p.id}`, topic: `pattern:${p.id}`, strength: p.confidence ?? 0.5, moved: changed },
      item: { id: `pattern:${p.id}`, kind: 'pattern', register: 'stated', facts: { label: p.label, instances: p.instances, trajectory: p.trajectory, counts: p.trajectoryDetail ? { prior: p.trajectoryDetail.prior, recent: p.trajectoryDetail.recent } : null }, evidence: [p.id] },
    });
  }
  for (const a of c.answers) {
    out.push({
      candidate: { id: `answer:${a.id}`, topic: `question:${a.questionId}`, strength: a.confidence, moved: moved.has(a.id) },
      item: { id: `answer:${a.id}`, kind: 'answer', register: a.register, facts: { question: a.question, answer: a.answer, confidence: a.confidence, sources: a.sources, confirmedByYou: a.confirmed }, evidence: [a.id] },
    });
  }
  for (const s of c.shifts) {
    out.push({
      candidate: { id: `shift:${s.domain}:${s.metric}`, topic: `shift:${s.domain}:${s.metric}`, strength: 0.6, moved: true },
      item: { id: `shift:${s.domain}:${s.metric}`, kind: 'shift', register: 'stated', facts: { what: s.label, direction: s.direction, thisWeek: s.recentMedian, usual: s.baselineMedian, days: s.recentDays }, evidence: s.sourceIds },
    });
  }
  for (const g of extras.saidVsDid ?? []) {
    const active = g.did.events + g.did.contentItems + g.did.patterns.length > 0;
    if (!active) continue;
    out.push({
      candidate: { id: `goal:${g.goalId}`, topic: `goal:${g.goalId}`, strength: 0.5, goalLinked: true, moved: g.did.hoursThisWeek !== g.did.hoursUsualWeek },
      item: { id: `goal:${g.goalId}`, kind: 'said_vs_did', register: 'stated', facts: { goal: g.title, said: g.said, did: g.did }, evidence: g.evidence },
    });
  }
  (extras.content ?? []).forEach((g, i) => {
    out.push({
      candidate: { id: `content:${i}`, topic: `content:${g.label ?? i}`, strength: Math.min(0.7, 0.4 + 0.05 * g.itemIds.length) },
      item: { id: `content:${i}`, kind: 'content', register: 'stated', facts: { topic: g.label, items: g.itemIds.length }, evidence: g.itemIds },
    });
  });
  return out;
}

export function planEpisode(c: UnderstandingContract, extras: Parameters<typeof buildCandidates>[1] = {}, maxItems = 6): EpisodePlan {
  const built = buildCandidates(c, extras);
  const byId = new Map(built.map((b) => [b.candidate.id, b.item]));
  const sel = selectItems(built.map((b) => b.candidate), maxItems);
  const items = sel.selected.map((id) => byId.get(id)!);
  const spine = items[0] ?? null;

  // One asked question: the why behind the spine if it's a pattern; else the
  // most confident why behind any selected pattern. Never more than one.
  const selectedPatterns = new Set(items.filter((i) => i.kind === 'pattern').map((i) => i.id.slice('pattern:'.length)));
  const spinePattern = spine?.kind === 'pattern' ? spine.id.slice('pattern:'.length) : null;
  const whys = c.whys.filter((w) => selectedPatterns.has(w.patternId)).sort((a, b) => Number(b.patternId === spinePattern) - Number(a.patternId === spinePattern) || b.confidence - a.confidence);
  const w = whys[0];

  return {
    spine, items,
    reflection: w ? { whyId: w.id, patternId: w.patternId, mechanism: w.mechanism } : null,
    withheld: Object.entries(sel.excluded).map(([id, why]) => ({ id, why })),
    silent: c.silent.map((s) => s.label),
  };
}
