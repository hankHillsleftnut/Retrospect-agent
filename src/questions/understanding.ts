/**
 * What the product may say about a person, read from the question store.
 *
 * The episode writers today work from the portrait document -- fluent prose,
 * much of it with nothing behind it (the false sleep claims came from there).
 * This gives them a second, stricter input: the current answers to the 36
 * questions, but only for the parts of a life that have cleared their bar to
 * speak, and an explicit list of the parts that have not.
 *
 * Additive. When the question store is empty or absent, the block is empty and
 * every prompt is exactly what it was before.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export interface KnownAnswer {
  questionId: number;
  question: string;
  answer: string;
  confidence: number;
  sources: number;
  confirmed: boolean;
  /** Other answers the evidence also supports: the product should say it is split. */
  alternatives: string[];
}

export interface Understanding {
  speaking: Array<{ domainId: string; label: string; answers: KnownAnswer[] }>;
  silent: Array<{ domainId: string; label: string; coverage: number; needed: number }>;
}

/** Read it for one person. Returns null if the question store is not there yet. */
export async function loadUnderstanding(userId: string, db: typeof supabase = supabase): Promise<Understanding | null> {
  const [coverage, answers, questions, domains] = await Promise.all([
    db.from(Tables.DOMAIN_COVERAGE).select('domain_id,label,coverage,speak_coverage,may_speak').eq('user_id', userId),
    db.from(Tables.QUESTION_ANSWERS).select('id,question_id,answer,user_verdict,status').eq('user_id', userId).eq('status', 'active'),
    db.from(Tables.CANONICAL_QUESTIONS).select('id,domain_id,text'),
    db.from(Tables.QUESTION_DOMAINS).select('id,confidence_floor,position'),
  ]);
  if (coverage.error || answers.error || questions.error || domains.error) return null;

  const { data: scores, error } = await db.from(Tables.ANSWER_CONFIDENCE)
    .select('answer_id,confidence,independent_sources').eq('user_id', userId);
  if (error) return null;

  return assembleUnderstanding({
    coverage: coverage.data ?? [], answers: answers.data ?? [], questions: questions.data ?? [],
    domains: domains.data ?? [], scores: scores ?? [],
  });
}

/** Pure: which answers may be spoken, and which domains must stay silent. */
export function assembleUnderstanding(rows: {
  coverage: any[]; answers: any[]; questions: any[]; domains: any[]; scores: any[];
}): Understanding {
  const floor = new Map(rows.domains.map((d) => [d.id, Number(d.confidence_floor)]));
  const position = new Map(rows.domains.map((d) => [d.id, Number(d.position)]));
  const question = new Map(rows.questions.map((q) => [q.id, q]));
  const score = new Map(rows.scores.map((s) => [s.answer_id, s]));

  // Group live, unrejected answers by question, most confident first.
  const byQuestion = new Map<number, Array<{ answer: string; confidence: number; sources: number; confirmed: boolean }>>();
  for (const a of rows.answers) {
    if (a.user_verdict === 'rejected') continue;
    const s = score.get(a.id);
    const list = byQuestion.get(a.question_id) ?? [];
    list.push({
      answer: a.answer,
      confidence: Number(s?.confidence ?? 0),
      sources: Number(s?.independent_sources ?? 0),
      confirmed: a.user_verdict === 'confirmed',
    });
    byQuestion.set(a.question_id, list);
  }

  const speaking: Understanding['speaking'] = [];
  const silent: Understanding['silent'] = [];
  const ordered = [...rows.coverage].sort((a, b) => (position.get(a.domain_id) ?? 0) - (position.get(b.domain_id) ?? 0));

  for (const c of ordered) {
    if (!c.may_speak) {
      silent.push({ domainId: c.domain_id, label: c.label, coverage: Number(c.coverage), needed: Number(c.speak_coverage) });
      continue;
    }
    const min = floor.get(c.domain_id) ?? 0;
    const answers: KnownAnswer[] = [];
    for (const [qid, list] of byQuestion) {
      const q = question.get(qid);
      if (!q || q.domain_id !== c.domain_id) continue;
      // Only answers that have earned it are spoken, even inside an open domain.
      const usable = list
        .filter((x) => x.confirmed || x.confidence >= min)
        .sort((x, y) => Number(y.confirmed) - Number(x.confirmed) || y.confidence - x.confidence);
      if (usable.length === 0) continue;
      const [best, ...rest] = usable;
      answers.push({
        questionId: qid, question: q.text, answer: best!.answer, confidence: best!.confidence,
        sources: best!.sources, confirmed: best!.confirmed, alternatives: rest.map((r) => r.answer),
      });
    }
    answers.sort((a, b) => a.questionId - b.questionId);
    speaking.push({ domainId: c.domain_id, label: c.label, answers });
  }
  return { speaking, silent };
}

/** The block a writer is given. Empty when there is nothing in the store. */
export function formatUnderstanding(u: Understanding | null): string {
  if (!u) return '';
  const known = u.speaking.flatMap((d) => d.answers);
  if (known.length === 0 && u.silent.length === 0) return '';

  const lines = u.speaking
    .filter((d) => d.answers.length > 0)
    .map((d) => `## ${d.label}\n${d.answers.map((a) => {
      const how = a.confirmed ? 'they confirmed this' : `confidence ${a.confidence.toFixed(2)}, ${a.sources} independent source${a.sources === 1 ? '' : 's'}`;
      const split = a.alternatives.length ? `\n    Evidence is split; it also supports: ${a.alternatives.map((x) => `"${x}"`).join('; ')}. Say so rather than choosing.` : '';
      return `  - ${a.question} ${a.answer} (${how})${split}`;
    }).join('\n')}`)
    .join('\n\n');

  const silent = u.silent.map((s) => `  - ${s.label} (${Math.round(s.coverage * 100)}% understood; needs ${Math.round(s.needed * 100)}%)`).join('\n');

  return `# WHAT WE KNOW, WITH EVIDENCE
These are the product's current answers about this person, each backed by counted evidence from their own data. Treat them as more reliable than anything in the User Understanding Document. Never state an inference as something they told you.

${lines || '(no part of their life is understood well enough to speak about yet)'}

# STAY SILENT ABOUT
These parts of their life are not yet understood well enough. Make no claims about them, even if other context here seems to suggest something. A question about them is fine; an assertion is not.
${silent || '  (none)'}`;
}
