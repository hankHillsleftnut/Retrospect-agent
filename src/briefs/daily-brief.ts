/**
 * The daily brief: what it is shown, and what survives.
 *
 * Approach B from docs/second-brain/brief-phase-5-coherence.md, tested on the
 * founder's writing on 19 October 2026: a brief is built around ONE answer about
 * the person that the day's material moved most (the spine). Items are chosen
 * because they bear on it, and each says why it is there (goal 11: relevance,
 * with its reason). On a quiet day the brief says so and stops -- the tested
 * alternative padded.
 *
 * Kept pure (no database, no model) so the rules can be tested:
 *   - every item quotes the material it rests on, and the quote must really be
 *     there (the same span rule facts obey);
 *   - at most one "aside" that doesn't bear on the spine;
 *   - nothing survives -> a quiet brief, never an invented one.
 */

import { verifyExcerpt } from '../brain/verify-span';

export interface BriefMaterial {
  /** Short handle the model cites, e.g. "M3". */
  handle: string;
  label: string;
  text: string;
  /** Full text a quote is checked against. */
  quotable: string;
  sourceRef: { raw_content_id: string };
}

export interface BriefAnswer {
  questionId: number;
  question: string;
  answer: string;
  confidence: number;
  /** How the researcher moved it since the last brief, if it did. */
  movedSince?: 'strengthened' | 'weakened' | 'revised' | 'first_answer';
}

export interface BriefItem {
  text: string;
  /** Why it is in the brief: how it bears on the spine. Null for the one aside. */
  why: string | null;
  quote: string;
  sourceRef: { raw_content_id: string };
}

export interface VettedBrief {
  kind: 'brief' | 'quiet';
  throughLine: string;
  spineQuestionId: number | null;
  spineMovement: string | null;
  items: BriefItem[];
  dropped: number;
}

export const MAX_ITEMS = 4;

export const DAILY_BRIEF_SYSTEM = `You write a short daily brief for one person, organised around ONE through-line.

Step 1. Read what is new since their last brief against their current answers to questions about who they are. Answers marked "moved" just gained or lost evidence. Pick the ONE question whose answer the new material bears on most -- strengthens, weakens, complicates, or contradicts. That question is the spine.
Step 2. State the through-line in one sentence: what the new material shows about that question.
Step 3. Choose 1-${MAX_ITEMS} items from the new material that bear on the spine. For each, "why" says how, in a few words. Two strong items beat four mixed ones: if you need more than one short clause to explain how an item connects, it does not belong. At most one extra item may be an aside, with "why": null.
If nothing new bears on any answer, return {"quiet": true, "through_line": "<one honest sentence>"} and nothing else.

Rules for anything said about the person:
- Only claim what the material or the answers support. Hedge where hedging is honest.
- Never assume pronouns; write to them as "you". Do not use em dashes.
- No asides about addresses, money owed, health records or other personal logistics: the brief is about who they are and where they're going, not admin.
- Each item gives "source" (the handle, e.g. "M3") and "quote": exact words copied from that item, 5 to 30 words.
Write warmly and plainly, as a friend who has read everything would. Short items, 1-3 sentences.
Reply with JSON only:
{"spine_question_id": n, "spine_movement": "strengthens|weakens|complicates|contradicts", "through_line": "...", "items": [{"text": "...", "why": "..." | null, "source": "M1", "quote": "..."}]}`;

export function buildBriefPrompt(answers: BriefAnswer[], material: BriefMaterial[]): string {
  const a = answers
    .map((x) => `Q${x.questionId} ${x.question} -> ${x.answer} (confidence ${x.confidence.toFixed(2)}${x.movedSince ? `, moved: ${x.movedSince}` : ''})`)
    .join('\n');
  const m = material.map((x) => `${x.handle} · ${x.label}\n${x.text}`).join('\n\n---\n\n');
  return `CURRENT ANSWERS\n${a}\n\nNEW SINCE THE LAST BRIEF\n${m}`;
}

export function quietBrief(throughLine = "Nothing new since your last brief. I'll keep listening."): VettedBrief {
  return { kind: 'quiet', throughLine, spineQuestionId: null, spineMovement: null, items: [], dropped: 0 };
}

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s*—\s*/g, ', ').trim() : '');

export function vetBrief(reply: Record<string, unknown>, material: BriefMaterial[], answers: BriefAnswer[]): VettedBrief {
  if (reply.quiet === true) return quietBrief(clean(reply.through_line) || undefined);

  const byHandle = new Map(material.map((m) => [m.handle, m]));
  const known = new Set(answers.map((a) => a.questionId));
  const raw = Array.isArray(reply.items) ? reply.items : [];
  const items: BriefItem[] = [];
  let dropped = 0;
  let asides = 0;

  for (const r of raw as Array<Record<string, unknown>>) {
    const source = byHandle.get(String(r.source ?? ''));
    const quote = clean(r.quote);
    const text = clean(r.text);
    const why = r.why === null ? null : clean(r.why) || null;
    const verified = source ? verifyExcerpt(quote, source.quotable) : { ok: false };
    if (!source || !text || !verified.ok || (why === null && asides >= 1) || items.length >= MAX_ITEMS + 1) {
      dropped += 1;
      continue;
    }
    if (why === null) asides += 1;
    items.push({ text, why, quote, sourceRef: source.sourceRef });
  }

  // Nothing grounded survived: say so rather than ship an empty or invented brief.
  if (!items.some((i) => i.why !== null)) return { ...quietBrief(), dropped: dropped + items.length };

  const spine = Number(reply.spine_question_id);
  return {
    kind: 'brief',
    throughLine: clean(reply.through_line),
    spineQuestionId: known.has(spine) ? spine : null,
    spineMovement: clean(reply.spine_movement) || null,
    items,
    dropped,
  };
}
