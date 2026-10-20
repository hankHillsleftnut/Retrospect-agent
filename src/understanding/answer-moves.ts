/**
 * What moved in the 36 answers since the last episode (W4.2, analysis 7).
 *
 * Confidence "then" is recomputed from the evidence that existed then, with the
 * same arithmetic as the answer_confidence view (migration 121), so nothing has
 * to be snapshotted and a replay gives the same answer. A move is reported
 * only when NEW evidence arrived; confidence fading with time is not news.
 *
 * Retired evidence (migration 138) counts for the time it was cited, so "then"
 * is what the brain believed then. Evidence deleted before 138 is gone.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { selectAll } from '../db/paged';

/** A move this size, or a new answer, is worth saying. Declared 19 Oct. */
export const MIN_MOVE = 0.15;
const DAY = 864e5;

export interface EvidenceRow { id: string; answer_id: string; stance: 'supports' | 'contradicts'; source_key: string; observed_at: string; created_at: string; weight: number; /** When a re-derivation stopped citing it (migration 138). */ retired_at?: string | null }

/** The view's arithmetic, at time t, over evidence known at t. Pure. */
export function confidenceAt(evidence: EvidenceRow[], t: Date, halfLifeDays: number): number {
  const best = new Map<string, number>();
  for (const e of evidence) {
    if (new Date(e.created_at).getTime() > t.getTime()) continue;
    // Evidence counts from when it was recorded until it was retired.
    if (e.retired_at && new Date(e.retired_at).getTime() <= t.getTime()) continue;
    const ageDays = (t.getTime() - new Date(e.observed_at).getTime()) / DAY;
    const vote = e.weight * Math.pow(0.5, ageDays / halfLifeDays);
    const k = `${e.stance}|${e.source_key}`;
    best.set(k, Math.max(best.get(k) ?? 0, vote));
  }
  let support = 0, against = 0;
  for (const [k, v] of best) if (k.startsWith('supports|')) support += v; else against += v;
  return support / (support + against + 2);
}

export interface AnswerMove {
  answerId: string; questionId: number;
  before: number | null; after: number;
  isNew: boolean;
  newSupporting: number; newContradicting: number;
  /** The evidence that moved it, for lineage. */
  evidenceIds: string[];
}

export function answerMoves(
  answers: Array<{ id: string; question_id: number; created_at: string; half_life_days: number }>,
  evidence: EvidenceRow[], since: Date, now: Date,
): AnswerMove[] {
  const byAnswer = new Map<string, EvidenceRow[]>();
  for (const e of evidence) (byAnswer.get(e.answer_id) ?? byAnswer.set(e.answer_id, []).get(e.answer_id)!).push(e);
  const out: AnswerMove[] = [];
  for (const a of answers) {
    const ev = byAnswer.get(a.id) ?? [];
    const fresh = ev.filter((e) => new Date(e.created_at).getTime() > since.getTime());
    const isNew = new Date(a.created_at).getTime() > since.getTime();
    if (!isNew && fresh.length === 0) continue;
    const before = isNew ? null : confidenceAt(ev, since, a.half_life_days);
    const after = confidenceAt(ev, now, a.half_life_days);
    if (!isNew && Math.abs(after - before!) < MIN_MOVE) continue;
    out.push({
      answerId: a.id, questionId: a.question_id,
      before: before === null ? null : Math.round(before * 100) / 100, after: Math.round(after * 100) / 100, isNew,
      newSupporting: fresh.filter((e) => e.stance === 'supports').length, newContradicting: fresh.filter((e) => e.stance === 'contradicts').length,
      evidenceIds: fresh.map((e) => e.id),
    });
  }
  return out.sort((x, y) => Math.abs(y.after - (y.before ?? 0)) - Math.abs(x.after - (x.before ?? 0)));
}

/** Since the last finished episode, or the last week if there isn't one. */
export async function readAnswerMoves(userId: string, db: typeof supabase = supabase, now = new Date()): Promise<{ since: string; moves: AnswerMove[] }> {
  const { data: ep } = await db.from(Tables.PODCAST_EPISODES).select('created_at').eq('user_id', userId).eq('status', 'ready')
    .order('created_at', { ascending: false }).limit(1);
  const since = new Date(((ep ?? []) as Array<{ created_at: string }>)[0]?.created_at ?? now.getTime() - 7 * DAY);

  const [answers, questions, domains, kinds, evidence] = await Promise.all([
    db.from(Tables.QUESTION_ANSWERS).select('id,question_id,created_at').eq('user_id', userId).eq('status', 'active'),
    db.from(Tables.CANONICAL_QUESTIONS).select('id,domain_id,half_life_days'),
    db.from(Tables.QUESTION_DOMAINS).select('id,half_life_days'),
    db.from(Tables.EVIDENCE_KINDS).select('id,weight'),
    selectAll<EvidenceRow & { kind_id: string }>((from, to) => db.from(Tables.ANSWER_EVIDENCE)
      .select('id,answer_id,stance,source_key,observed_at,created_at,kind_id,retired_at').eq('user_id', userId).order('id').range(from, to)),
  ]);
  for (const r of [answers, questions, domains, kinds]) if (r.error) throw new Error(`readAnswerMoves: ${r.error.message}`);
  const domainHalf = new Map(((domains.data ?? []) as Array<{ id: string; half_life_days: number }>).map((d) => [d.id, d.half_life_days]));
  const qHalf = new Map(((questions.data ?? []) as Array<{ id: number; domain_id: string; half_life_days: number | null }>).map((q) => [q.id, q.half_life_days ?? domainHalf.get(q.domain_id) ?? 60]));
  const weight = new Map(((kinds.data ?? []) as Array<{ id: string; weight: number | string }>).map((k) => [k.id, Number(k.weight)]));
  const rows = evidence.map((e) => ({ ...e, weight: weight.get(e.kind_id) ?? 0 }));
  const ans = ((answers.data ?? []) as Array<{ id: string; question_id: number; created_at: string }>).map((a) => ({ ...a, half_life_days: qHalf.get(a.question_id) ?? 60 }));
  return { since: since.toISOString(), moves: answerMoves(ans, rows, since, now) };
}
