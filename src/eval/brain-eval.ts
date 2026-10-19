/**
 * Scoring the brain against an evaluation persona (F2, design change C2).
 *
 * Modelled on LongMemEval's five abilities: extraction, multi-session
 * reasoning, knowledge updates, temporal reasoning and abstention. The reader
 * sees only what the brain stored (facts, patterns, whys), never the raw
 * entries, so a score measures what the brain kept, not what a model can read.
 * Pure functions here; the run lives in scripts/eval-brain.ts.
 */

export const ABILITIES = ['extraction', 'multi_session', 'update', 'temporal', 'abstention'] as const;
export type Ability = (typeof ABILITIES)[number];

export interface EvalQuestion {
  id: string; ability: Ability; question: string;
  answer?: string; abstain?: boolean; reason?: string;
  /** Each entry must appear; "a|b" means either. */
  must_include?: string[];
  must_not_say?: string[];
  support?: string[];
  /** Items that must not be cited: automated guesses about the person. */
  must_not_cite?: string[];
}

export interface ReaderAnswer { id: string; abstain: boolean; answer: string; cites: string[] }

export interface Verdict { id: string; ability: Ability; correct: boolean; why: string }

/**
 * One question. `citedItems` is the set of persona items the reader's cited
 * claims rest on (via walkEvidence), so a trap is caught however indirect.
 */
export function scoreOne(q: EvalQuestion, a: ReaderAnswer | undefined, citedItems: Set<string>): Verdict {
  const v = (correct: boolean, why: string): Verdict => ({ id: q.id, ability: q.ability, correct, why });
  if (!a) return v(false, 'no answer');
  // Noticing a trap and declining is right; answering on the strength of it is not.
  const trap = (q.must_not_cite ?? []).find((id) => citedItems.has(id));
  if (trap && !a.abstain) return v(false, `rested on ${trap}, an automated guess`);
  if (q.abstain) return a.abstain ? v(true, 'abstained') : v(false, `answered instead of abstaining: ${a.answer}`);
  if (a.abstain) return v(false, 'abstained, but the brain should know');
  const text = a.answer.toLowerCase();
  const missing = (q.must_include ?? []).filter((alts) => !alts.toLowerCase().split('|').some((s) => text.includes(s)));
  if (missing.length) return v(false, `missing ${missing.join(', ')}`);
  const said = (q.must_not_say ?? []).find((s) => text.includes(s.toLowerCase()));
  if (said) return v(false, `said "${said}"`);
  return v(true, 'correct');
}

export interface AbilityScore { ability: Ability; correct: number; total: number; rate: number }

export function scoreByAbility(verdicts: Verdict[]): AbilityScore[] {
  return ABILITIES.map((ability) => {
    const mine = verdicts.filter((x) => x.ability === ability);
    const correct = mine.filter((x) => x.correct).length;
    return { ability, correct, total: mine.length, rate: mine.length ? correct / mine.length : 0 };
  });
}

export const READER_SYSTEM = `You answer questions about one person using ONLY the memory records you are given.
Each record has an id. You never see the person's original writing, only what was remembered.

Rules:
- If the records don't establish the answer, abstain. Abstaining is correct, not a failure.
- A record that only guesses at the person's feelings or motives from automated mail is not evidence about them.
- A why is never known unless the person said it. Don't infer motives.
- Prefer the most recent record when records disagree; a goal that was dropped is no longer active.
- Cite the ids of the records your answer rests on.

Reply with JSON only: {"answers":[{"id":"<question id>","abstain":true|false,"answer":"<short answer, or why you can't say>","cites":["<record id>",...]}]}`;

export function readerPrompt(records: Array<{ id: string; text: string }>, questions: EvalQuestion[], asOf: string): string {
  return `Today is ${asOf}.

MEMORY RECORDS
${records.map((r) => `[${r.id}] ${r.text}`).join('\n')}

QUESTIONS
${questions.map((q) => `${q.id}: ${q.question}`).join('\n')}`;
}
