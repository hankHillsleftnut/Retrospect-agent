/**
 * Apply a correction (goal 20, F-C1): load the person's current lineage, plan
 * the retraction (retract.ts, pure), then write it. Invalidate, never delete:
 * claims change status, dropped answer evidence gets retired_at.
 */

import { supabase } from '../db/supabase';
import { selectAll, chunks } from '../db/paged';
import type { ClaimKind } from '../brain/lineage';
import { planRetraction, type Edge, type RetractionPlan } from './retract';

type Db = typeof supabase;

/** Mirrors fact_claim_key() in migration 148; tested against it. Pure. */
export function factClaimKey(predicate: string, objectEntityId: string | null, objectValue: { normalized?: unknown; raw?: unknown } | null): string {
  return `${predicate}|${objectEntityId ?? String(objectValue?.normalized ?? objectValue?.raw ?? '').trim().toLowerCase()}`;
}

/** Mirrors answer_claim_key() in migration 148; tested against it. Pure. */
export function answerClaimKey(questionId: number, answer: string | null): string {
  return `${questionId}|${(answer ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

/** Claims already out of play (retired, rejected, superseded): they can't count as support. */
async function inactiveClaims(userId: string, db: Db): Promise<Set<string>> {
  const out = new Set<string>();
  const add = (kind: ClaimKind, rows: Array<{ id: string }>) => rows.forEach((r) => out.add(`${kind}:${r.id}`));
  add('fact', await selectAll<{ id: string }>((f, t) => db.from('assertions').select('id').eq('user_id', userId).neq('status', 'active').order('id').range(f, t)));
  add('pattern', await selectAll<{ id: string }>((f, t) => db.from('behavior_patterns').select('id').eq('user_id', userId).in('status', ['retired', 'user_rejected']).order('id').range(f, t)));
  add('why', await selectAll<{ id: string }>((f, t) => db.from('behavior_pattern_whys').select('id').eq('user_id', userId).in('status', ['retired', 'user_rejected']).order('id').range(f, t)));
  add('answer', await selectAll<{ id: string }>((f, t) => db.from('question_answers').select('id').eq('user_id', userId).eq('status', 'retired').order('id').range(f, t)));
  return out;
}

/** The current lineage. Answer evidence comes straight from its table so retired edges stay out. */
async function currentEdges(userId: string, db: Db): Promise<Edge[]> {
  const rows = await selectAll<{ claim_kind: ClaimKind; claim_id: string; evidence_kind: Edge['evidence']['kind']; evidence_id: string; role: string | null }>(
    (f, t) => db.from('claim_edges').select('claim_kind,claim_id,evidence_kind,evidence_id,role').eq('user_id', userId).neq('claim_kind', 'answer').order('claim_id').order('evidence_id').range(f, t));
  const answers = await selectAll<{ answer_id: string; assertion_id: string | null; pattern_id: string | null; raw_content_id: string | null; stance: string | null }>(
    (f, t) => db.from('answer_evidence').select('answer_id,assertion_id,pattern_id,raw_content_id,stance').eq('user_id', userId).is('retired_at', null).order('id').range(f, t));
  return [
    ...rows.map((r) => ({ claim: { kind: r.claim_kind, id: r.claim_id }, evidence: { kind: r.evidence_kind, id: r.evidence_id }, role: r.role })),
    ...answers.map((a) => ({
      claim: { kind: 'answer' as const, id: a.answer_id },
      evidence: a.assertion_id ? { kind: 'fact' as const, id: a.assertion_id } : a.pattern_id ? { kind: 'pattern' as const, id: a.pattern_id } : { kind: 'raw_content' as const, id: a.raw_content_id! },
      role: a.stance,
    })),
  ];
}

export async function planCorrection(userId: string, target: { kind: ClaimKind; id: string }, db: Db = supabase): Promise<RetractionPlan> {
  return planRetraction(target, await currentEdges(userId, db), await inactiveClaims(userId, db));
}

/** Ids of the answer evidence a weakened answer loses: its live rows resting on the dropped facts or patterns. */
async function droppedEvidenceIds(userId: string, plan: RetractionPlan, db: Db): Promise<string[]> {
  const ids: string[] = [];
  for (const w of plan.weaken.filter((x) => x.claim.kind === 'answer')) {
    for (const kind of ['fact', 'pattern'] as const) {
      const dropped = w.dropped.filter((d) => d.kind === kind).map((d) => d.id);
      for (const part of chunks(dropped)) {
        const { data, error } = await db.from('answer_evidence').select('id')
          .eq('user_id', userId).eq('answer_id', w.claim.id)
          .in(kind === 'fact' ? 'assertion_id' : 'pattern_id', part).is('retired_at', null);
        if (error) throw new Error(`applyCorrection: answer evidence ${w.claim.id}: ${error.message}`);
        ids.push(...((data ?? []) as Array<{ id: string }>).map((r) => r.id));
      }
    }
  }
  return ids;
}

/**
 * Retire what the plan says. `dryRun` returns the plan and writes nothing.
 *
 * Every write happens in one call to apply_correction (migration 152), so in
 * one transaction: the rejection, the retirements and the dropped evidence
 * land together or not at all. Answers and their evidence are written only
 * through that function, as migration 121 requires; the service role can't
 * update those tables directly.
 */
export async function applyCorrection(userId: string, target: { kind: ClaimKind; id: string }, options: { db?: Db; dryRun?: boolean; now?: Date; note?: string; mode?: 'wrong' | 'changed' } = {}): Promise<RetractionPlan> {
  const db = options.db ?? supabase;
  const plan = await planCorrection(userId, target, db);
  if (options.dryRun) return plan;
  const { error } = await db.rpc('apply_correction', {
    p: {
      user_id: userId,
      at: (options.now ?? new Date()).toISOString(),
      // "Wrong" records the rejection so the claim can't come back; "changed"
      // was true until now: it retires as of today but isn't blacklisted.
      mode: options.mode === 'changed' ? 'changed' : 'wrong',
      note: options.note ?? null,
      target,
      retire: plan.retire.map((r) => ({ kind: r.kind, id: r.id, rejected: r.because === 'rejected' })),
      evidence_ids: await droppedEvidenceIds(userId, plan, db),
    },
  });
  if (error) throw new Error(`applyCorrection: ${error.code ?? 'failed'}`);
  return plan;
}
