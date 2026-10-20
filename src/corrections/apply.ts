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

/** Remember what the person rejected, so no later write can bring it back (migration 148). */
async function recordRejection(userId: string, target: { kind: ClaimKind; id: string }, db: Db, note?: string): Promise<void> {
  let claimKey: string | null = null;
  if (target.kind === 'fact') {
    const { data } = await db.from('assertions').select('predicate,object_entity_id,object_value').eq('id', target.id).eq('user_id', userId).maybeSingle();
    const f = data as { predicate: string; object_entity_id: string | null; object_value: { normalized?: unknown; raw?: unknown } | null } | null;
    if (f) claimKey = factClaimKey(f.predicate, f.object_entity_id, f.object_value);
  } else if (target.kind === 'answer') {
    const { data } = await db.from('question_answers').select('question_id,answer').eq('id', target.id).eq('user_id', userId).maybeSingle();
    const a = data as { question_id: number; answer: string | null } | null;
    if (a) claimKey = answerClaimKey(a.question_id, a.answer);
  }
  // Patterns and whys are already never resurrected by their writers (status user_rejected).
  if (!claimKey) return;
  const { error } = await db.from('claim_rejections').upsert({ user_id: userId, claim_kind: target.kind, claim_key: claimKey, source_id: target.id, note: note ?? null }, { onConflict: 'user_id,claim_kind,claim_key' });
  if (error) throw new Error(`recordRejection: ${error.message}`);
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

/** Retire what the plan says. `dryRun` returns the plan and writes nothing. */
export async function applyCorrection(userId: string, target: { kind: ClaimKind; id: string }, options: { db?: Db; dryRun?: boolean; now?: Date; note?: string; mode?: 'wrong' | 'changed' } = {}): Promise<RetractionPlan> {
  const db = options.db ?? supabase;
  const plan = await planCorrection(userId, target, db);
  if (options.dryRun) return plan;
  const at = (options.now ?? new Date()).toISOString();
  // "Wrong" is recorded first, so if anything below fails the claim still can't come back.
  // "Changed" was true until now: it retires as of today but isn't blacklisted,
  // so if they say it again later it's believed again.
  if (options.mode !== 'changed') await recordRejection(userId, target, db, options.note);

  for (const r of plan.retire) {
    const rejected = r.because === 'rejected';
    const write = r.kind === 'fact'
      ? db.from('assertions').update({ status: 'retired', valid_to: at }).eq('id', r.id).eq('user_id', userId)
      : r.kind === 'pattern'
        ? db.from('behavior_patterns').update({ status: rejected ? 'user_rejected' : 'retired' }).eq('id', r.id).eq('user_id', userId)
        : r.kind === 'why'
          ? db.from('behavior_pattern_whys').update({ status: rejected ? 'user_rejected' : 'retired', retired_at: at, retirement_reason: rejected ? 'rejected by the person' : 'its support was corrected away' }).eq('id', r.id).eq('user_id', userId)
          : db.from('question_answers').update({ status: 'retired', retired_at: at, ...(rejected ? { user_verdict: 'rejected', verdict_at: at } : {}) }).eq('id', r.id).eq('user_id', userId);
    const { error } = await write;
    if (error) throw new Error(`applyCorrection: ${r.kind} ${r.id}: ${error.message}`);
  }

  // Answers that survive lose the rejected evidence, so their confidence is recomputed from what's left.
  for (const w of plan.weaken.filter((x) => x.claim.kind === 'answer')) {
    for (const kind of ['fact', 'pattern'] as const) {
      const ids = w.dropped.filter((d) => d.kind === kind).map((d) => d.id);
      for (const part of chunks(ids)) {
        const { error } = await db.from('answer_evidence').update({ retired_at: at }).eq('answer_id', w.claim.id).in(kind === 'fact' ? 'assertion_id' : 'pattern_id', part).is('retired_at', null);
        if (error) throw new Error(`applyCorrection: answer evidence ${w.claim.id}: ${error.message}`);
      }
    }
  }
  return plan;
}
