/**
 * The first pass: a best guess at every canonical question.
 *
 * Founder's decision, 18 October 2026: once onboarding is done and the
 * integrations are in, make a best guess at all 36, then grow confidence from
 * there. A guess may be weak; it may not be baseless.
 *
 * This file is the judgment, kept pure so it can be tested without a model or
 * a database: what the model is shown, and which of its guesses survive.
 * run-first-pass.ts does the plumbing.
 *
 * What a guess must survive before it is saved:
 *   - Every citation must name an item the model was actually shown.
 *   - A citation of something the person wrote must quote it, and the quote must
 *     appear in the original word for word (the same span rule facts obey).
 *   - Questions about feelings and wants need at least one of their own words.
 *   - The model's own confidence is discarded. Models are measurably
 *     overconfident about themselves; confidence comes only from counting
 *     evidence, in the database.
 * The database then checks everything again (migration 121). This layer exists
 * to report clearly what was dropped and why, not to be the guarantee.
 */

import { verifyExcerpt } from '../brain/verify-span';

// ── What the model is shown ─────────────────────────────────────────────────

export interface Question {
  id: number;
  domainId: string;
  text: string;
  requiresOwnWords: boolean;
  hypothesisOnly: boolean;
}

export type EvidenceRef =
  | { raw_content_id: string }
  | { assertion_id: string }
  | { pattern_id: string };

export interface PoolItem {
  /** Short stable handle, e.g. "E12". The model cites these, never raw ids. */
  handle: string;
  ref: EvidenceRef;
  /** Whether these are the person's own words. Mirrors the database's rule. */
  ownWords: boolean;
  /** Human label: what it is and when, e.g. "journal · 2026-06-09". */
  label: string;
  text: string;
  /** For items the person wrote: the full text a quote is checked against. */
  quotable?: string;
  /** When it reached the system. The researcher uses this to find what is new. */
  at?: string;
}

/** Content types that are the person's own words. Same list as migration 121. */
export const OWN_WORDS_CONTENT_TYPES = new Set([
  'journal_entry', 'voice_journal', 'voice_recording', 'text_entry', 'video_entry',
  'onboarding_profile', 'google_docs',
]);

/** How much of one item the model sees. The quote check uses the full text. */
export const ITEM_PREVIEW_CHARS = 700;

export const FIRST_PASS_SYSTEM = `You are working out who a person is from what they have already written and done. You never ask them anything. You are making a careful first guess that will be strengthened or overturned by later evidence.

For each question you are given, either:
  - give your best guess, citing the items it rests on; or
  - say there is no basis, if nothing shown bears on it.

A guess can be tentative. It cannot be invented. If you would be guessing from nothing, say "no basis".

Rules:
1. Cite items only by their handle (E1, E2, ...). Cite only items shown to you.
2. When you cite an item marked THEIR WORDS, copy a short exact quote from it (under 25 words), character for character. Quotes are checked; a paraphrase is discarded.
3. If an item points against your guess, cite it with "stance": "contradicts". Do not hide disagreement.
4. Questions marked OWN WORDS ONLY can only be answered from items marked THEIR WORDS. A health or calendar record cannot tell you how someone feels or what they want.
5. A zero or missing reading in a health or screen-time record means "not recorded", never "none".
6. Write the answer in one or two plain sentences, specific to this person, in the third person. No hedging words; uncertainty is tracked separately. Never diagnose, never use clinical language. Refer to the person as "they" unless their own words state their pronouns. Never mention item handles (E1, E2, ...) in the answer text; they belong only in "evidence".
7. Never present an inference as something they told you.

Return STRICT JSON only:
{"answers": [{"question": <number>, "answer": "<text>" | null, "no_basis": <boolean>, "evidence": [{"handle": "E3", "quote": "<exact words, for THEIR WORDS items>", "stance": "supports" | "contradicts"}]}]}`;

export function buildFirstPassPrompt(domainLabel: string, questions: Question[], pool: PoolItem[]): string {
  const qs = questions
    .map((q) => `${q.id}. ${q.text}${q.requiresOwnWords ? '  [OWN WORDS ONLY]' : ''}`)
    .join('\n');
  const items = pool
    .map((i) => `${i.handle} · ${i.ownWords ? 'THEIR WORDS' : 'RECORD'} · ${i.label}\n${i.text.slice(0, ITEM_PREVIEW_CHARS)}`)
    .join('\n\n');
  return `# Part of their life: ${domainLabel}\n\n## Questions\n${qs}\n\n## What is on record (${pool.length} items)\n\n${items}\n\nAnswer every question above. Return STRICT JSON.`;
}

// ── What survives ───────────────────────────────────────────────────────────

export interface ModelAnswer {
  question?: unknown;
  answer?: unknown;
  no_basis?: unknown;
  evidence?: unknown;
  // Anything else the model volunteers -- notably a confidence -- is ignored.
}

export interface Guess {
  questionId: number;
  answer: string;
  evidence: Array<EvidenceRef & { stance: 'supports' | 'contradicts'; excerpt?: string }>;
}

export type Outcome =
  | { questionId: number; status: 'guessed'; guess: Guess; dropped: DroppedCitation[] }
  | { questionId: number; status: 'no_basis' | 'gated' | 'unsupported' | 'not_returned'; dropped: DroppedCitation[] };

export interface DroppedCitation {
  handle: string;
  reason: 'unknown_handle' | 'missing_quote' | 'quote_not_found';
}

export const MAX_ANSWER_CHARS = 400;

/**
 * Turn the model's reply for one domain into guesses fit to record, and a
 * clear account of everything that was not.
 */
export function vetFirstPass(questions: Question[], pool: PoolItem[], reply: { answers?: unknown }): Outcome[] {
  const byHandle = new Map(pool.map((i) => [i.handle, i]));
  const replies = new Map<number, ModelAnswer>();
  for (const a of Array.isArray(reply.answers) ? (reply.answers as ModelAnswer[]) : []) {
    const id = Number(a?.question);
    if (Number.isInteger(id) && !replies.has(id)) replies.set(id, a);
  }

  return questions.map((q): Outcome => {
    // Goal 21: these are answered only by the hypothesis engine, under its
    // gates. The first pass does not attempt them.
    if (q.hypothesisOnly) return { questionId: q.id, status: 'gated', dropped: [] };

    const a = replies.get(q.id);
    if (!a) return { questionId: q.id, status: 'not_returned', dropped: [] };
    const text = typeof a.answer === 'string' ? a.answer.trim() : '';
    if (a.no_basis === true || !text) return { questionId: q.id, status: 'no_basis', dropped: [] };

    const { kept, dropped, supported } = vetCitations(a.evidence, byHandle, q.requiresOwnWords);
    if (!supported) return { questionId: q.id, status: 'unsupported', dropped };

    return {
      questionId: q.id,
      status: 'guessed',
      guess: { questionId: q.id, answer: text.slice(0, MAX_ANSWER_CHARS), evidence: kept },
      dropped,
    };
  });
}

export type VettedEvidence = Guess['evidence'];

/**
 * Check a model's citations against what it was shown. Shared by the first
 * pass and the researcher, so both obey exactly the same rules.
 *
 * `supported` is true when at least one supporting citation survived -- and,
 * for questions that need the person's own words, at least one of those.
 */
export function vetCitations(
  rawEvidence: unknown,
  byHandle: Map<string, PoolItem>,
  requiresOwnWords: boolean,
): { kept: VettedEvidence; dropped: DroppedCitation[]; supported: boolean } {
  const dropped: DroppedCitation[] = [];
  const kept: VettedEvidence = [];
  const usedOwnWords: boolean[] = [];
  const seen = new Set<string>();

  for (const raw of Array.isArray(rawEvidence) ? (rawEvidence as Record<string, unknown>[]) : []) {
    const handle = String(raw?.handle ?? '');
    const stance = raw?.stance === 'contradicts' ? 'contradicts' : 'supports';
    const item = byHandle.get(handle);
    if (!item) { dropped.push({ handle, reason: 'unknown_handle' }); continue; }
    if (seen.has(`${handle}:${stance}`)) continue;

    let excerpt: string | undefined;
    if (item.quotable !== undefined) {
      const quote = typeof raw?.quote === 'string' ? raw.quote : '';
      if (!quote.trim()) { dropped.push({ handle, reason: 'missing_quote' }); continue; }
      const check = verifyExcerpt(quote, item.quotable);
      if (!check.ok) { dropped.push({ handle, reason: 'quote_not_found' }); continue; }
      excerpt = check.matchedText;
    }

    seen.add(`${handle}:${stance}`);
    kept.push({ ...item.ref, stance, ...(excerpt ? { excerpt } : {}) });
    if (stance === 'supports') usedOwnWords.push(item.ownWords);
  }

  const supported = requiresOwnWords ? usedOwnWords.some(Boolean) : usedOwnWords.length > 0;
  return { kept, dropped, supported };
}

/** One derivation per question per person: re-running the first pass updates it. */
export function firstPassDerivationKey(questionId: number): string {
  return `first_pass:q${questionId}`;
}
