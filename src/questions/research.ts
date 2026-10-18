/**
 * The ambient researcher: keeps re-reading a person's data, question by
 * question, and moves each answer's confidence up or down.
 *
 * Founder's decision, 18 October 2026: "you should always be researching the
 * data to see if you can find stronger answers to each one of the questions,
 * all ambiently."
 *
 * Pure judgment, kept apart from plumbing (run-research.ts) so it is testable:
 *   - which questions are worth a look today;
 *   - what the model is shown for one question;
 *   - which of its conclusions survive.
 *
 * Two economies keep it affordable at scale:
 *   - It only looks at a question when something new has arrived since it last
 *     looked. Re-reading unchanged material can only cost money.
 *   - It shows the model the current answer, what it rests on, and only what is
 *     new -- never the whole history again.
 */

import { createHash } from 'node:crypto';
import { vetCitations, MAX_ANSWER_CHARS, ITEM_PREVIEW_CHARS, type DroppedCitation, type PoolItem, type Question, type VettedEvidence } from './first-pass';

export interface CurrentAnswer {
  answerId: string;
  derivationKey: string;
  derivedBy: string;
  answer: string;
  confidence: number;
  /** What it rests on today, as items the model can see and re-cite. */
  evidence: Array<PoolItem & { stance: 'supports' | 'contradicts'; excerpt?: string | null }>;
}

export interface QuestionState {
  question: Question;
  /** The domain's confidence floor: below it, the answer does not count. */
  floor: number;
  current: CurrentAnswer | null;
  /** Answers pointing elsewhere. More than one means the evidence is split. */
  competing: number;
  /** New items since this question was last researched. */
  newItems: PoolItem[];
}

/** Questions researched per person per run. */
export const RESEARCH_BUDGET = 6;

/**
 * Which questions to look at, most useful first.
 *
 * Only questions with something new. Among those: an unanswered question first,
 * then the furthest below its domain's floor, then those already above it (new
 * evidence can still contradict a confident answer). Hypothesis-only questions
 * are left to the hypothesis engine.
 */
export function pickQuestions<T extends QuestionState>(states: T[], budget = RESEARCH_BUDGET): T[] {
  const score = (s: QuestionState) => {
    if (!s.current) return 2;
    const gap = s.floor - s.current.confidence;
    return gap > 0 ? 1 + gap : 0.5 - Math.min(0.4, -gap);
  };
  return states
    .filter((s) => !s.question.hypothesisOnly && s.newItems.length > 0)
    .sort((a, b) => score(b) - score(a) || a.question.id - b.question.id)
    .slice(0, budget);
}

export const RESEARCH_SYSTEM = `You keep a running, evidence-based understanding of one person. You never ask them anything. You are given one question about them, the current best answer (if any) with what it rests on, and items that have arrived since it was last looked at.

Decide one of:
  - "unchanged": the new items do not bear on this question.
  - "update": the new items bear on the CURRENT answer. Cite those that support it and those that cut against it ("stance": "contradicts"). Do not restate the answer.
  - "revise": the evidence now points to a DIFFERENT answer. Give it and cite what it rests on (new or existing items). The old answer is kept alongside, not erased.
  - "answer": there is no current answer and the items now give a basis for one.
  - "no_basis": there is no current answer and still nothing to go on.

Rules:
1. Cite items only by handle. Cite only items shown.
2. For items marked THEIR WORDS, copy a short exact quote (under 25 words), character for character. Quotes are checked; a paraphrase is discarded.
3. OWN WORDS ONLY questions can only be answered from THEIR WORDS items.
4. A zero or missing reading in a health or screen-time record means "not recorded", never "none".
5. Answers are one or two plain sentences, specific, third person, no hedging words, never clinical, never presenting an inference as something they said.
6. Prefer "unchanged" to a strained connection. Only cite what genuinely bears on the question.

Return STRICT JSON only:
{"verdict": "unchanged" | "update" | "revise" | "answer" | "no_basis", "answer": "<text, for revise or answer>", "evidence": [{"handle": "E3", "quote": "<exact words, for THEIR WORDS>", "stance": "supports" | "contradicts"}]}`;

/** Handles for the current answer's evidence and the new items, together. */
export function researchPool(state: QuestionState): PoolItem[] {
  const pool: PoolItem[] = [];
  const add = (item: PoolItem) => pool.push({ ...item, handle: `E${pool.length + 1}` });
  for (const e of state.current?.evidence ?? []) add(e);
  for (const n of state.newItems) add(n);
  return pool;
}

export function buildResearchPrompt(state: QuestionState, pool: PoolItem[]): string {
  const q = state.question;
  const existing = state.current?.evidence.length ?? 0;
  const line = (i: PoolItem) =>
    `${i.handle} · ${i.ownWords ? 'THEIR WORDS' : 'RECORD'} · ${i.label}\n${i.text.slice(0, ITEM_PREVIEW_CHARS)}`;
  const current = state.current
    ? `## Current answer\n${state.current.answer}\n\n### It rests on\n${pool.slice(0, existing).map(line).join('\n\n')}`
    : '## Current answer\nNone yet.';
  const split = state.competing > 1 ? `\n\n(There are ${state.competing} competing answers; the evidence is already split.)` : '';
  return `# Question ${q.id}: ${q.text}${q.requiresOwnWords ? '  [OWN WORDS ONLY]' : ''}\n\n${current}${split}\n\n## New since last looked (${pool.length - existing} items)\n\n${pool.slice(existing).map(line).join('\n\n')}\n\nReturn STRICT JSON.`;
}

export type ResearchAction =
  | { kind: 'unchanged' | 'no_basis'; dropped: DroppedCitation[] }
  | { kind: 'unsupported'; dropped: DroppedCitation[] }
  | { kind: 'update'; outcome: 'strengthened' | 'weakened'; add: VettedEvidence; dropped: DroppedCitation[] }
  | { kind: 'revise' | 'first_answer'; answer: string; evidence: VettedEvidence; dropped: DroppedCitation[] };

/** What the researcher may do with the model's reply, after the same checks as the first pass. */
export function vetResearch(state: QuestionState, pool: PoolItem[], reply: Record<string, unknown>): ResearchAction {
  const verdict = String(reply?.verdict ?? '');
  const byHandle = new Map(pool.map((i) => [i.handle, i]));
  const text = typeof reply?.answer === 'string' ? reply.answer.trim().slice(0, MAX_ANSWER_CHARS) : '';

  if (verdict === 'unchanged' || verdict === 'no_basis') return { kind: verdict, dropped: [] };

  if (verdict === 'update') {
    if (!state.current) return { kind: 'unsupported', dropped: [] };
    // Only citations of NEW items move confidence; re-citing what the answer
    // already rests on would be counting the same vote twice.
    const existing = state.current.evidence.length;
    const newHandles = new Set(pool.slice(existing).map((i) => i.handle));
    const { kept, dropped } = vetCitations(
      (Array.isArray(reply.evidence) ? reply.evidence : []).filter((e: any) => newHandles.has(String(e?.handle))),
      byHandle,
      false,
    );
    if (kept.length === 0) return { kind: 'unsupported', dropped };
    const against = kept.filter((e) => e.stance === 'contradicts').length;
    return { kind: 'update', outcome: against >= kept.length - against ? 'weakened' : 'strengthened', add: kept, dropped };
  }

  if (verdict === 'revise' || verdict === 'answer') {
    if (!text) return { kind: 'unsupported', dropped: [] };
    const { kept, dropped, supported } = vetCitations(reply.evidence, byHandle, state.question.requiresOwnWords);
    if (!supported) return { kind: 'unsupported', dropped };
    return { kind: verdict === 'revise' && state.current ? 'revise' : 'first_answer', answer: text, evidence: kept, dropped };
  }

  return { kind: 'unsupported', dropped: [] };
}

/** The evidence to re-record an updated answer with: what it had, plus what is new. */
export function mergeEvidence(current: CurrentAnswer, add: VettedEvidence): VettedEvidence {
  const key = (e: Record<string, unknown>) =>
    `${e.stance}:${e.raw_content_id ?? ''}:${e.assertion_id ?? ''}:${e.pattern_id ?? ''}`;
  const merged = new Map<string, VettedEvidence[number]>();
  for (const e of current.evidence) {
    const entry = { ...e.ref, stance: e.stance, ...(e.excerpt ? { excerpt: e.excerpt } : {}) } as VettedEvidence[number];
    merged.set(key(entry), entry);
  }
  for (const e of add) merged.set(key(e), e);
  return [...merged.values()];
}

/** A revised answer is a new, competing derivation, keyed by its content. */
export function researchDerivationKey(questionId: number, answer: string): string {
  return `researcher:q${questionId}:${createHash('sha256').update(answer).digest('hex').slice(0, 16)}`;
}
