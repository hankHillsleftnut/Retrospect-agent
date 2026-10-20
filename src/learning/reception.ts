/**
 * Goal 19: learn from its own track record, only about its own reception.
 * For each kind of question it asks, how often the person responds, as a
 * Bayesian average (Beta(1,1) prior), turned into a weight bounded to
 * 0.8-1.2 that only orders things every gate already allows. It reads what
 * was asked and whether it was answered; it writes only its own scorecard,
 * never a claim about the person. See approach-calibration.md, goal 19.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { selectAll } from '../db/paged';

export interface Asked { arm: string; id: string; at: string }
export interface ArmStat { arm: string; asked: number; answered: number; rate: number; weight: number }
export const WEIGHT_MIN = 0.8;
export const WEIGHT_MAX = 1.2;

/** Pure: per kind of question, the smoothed answer rate and a bounded weight against this person's overall rate. */
export function armStats(asked: Asked[], answered: Set<string>): ArmStat[] {
  const by = new Map<string, { asked: number; answered: number }>();
  for (const a of asked) {
    const s = by.get(a.arm) ?? { asked: 0, answered: 0 };
    s.asked++; if (answered.has(a.id)) s.answered++;
    by.set(a.arm, s);
  }
  const total = [...by.values()].reduce((t, s) => ({ asked: t.asked + s.asked, answered: t.answered + s.answered }), { asked: 0, answered: 0 });
  const overall = (total.answered + 1) / (total.asked + 2);
  return [...by.entries()].map(([arm, s]) => {
    const rate = (s.answered + 1) / (s.asked + 2);
    const weight = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, rate / overall));
    return { arm, asked: s.asked, answered: s.answered, rate: Number(rate.toFixed(3)), weight: Number(weight.toFixed(3)) };
  }).sort((a, b) => a.arm.localeCompare(b.arm));
}

/** Pure: the weight for an arm; 1.0 when it has never been asked. */
export function weightFor(stats: ArmStat[] | undefined, arm: string): number {
  return stats?.find((s) => s.arm === arm)?.weight ?? 1;
}

/** What it has asked, from the plans of its own episodes. */
export async function readAsked(userId: string, db: typeof supabase = supabase): Promise<Asked[]> {
  const eps = await selectAll<{ outline: any; created_at: string }>((f, t) => db.from(Tables.PODCAST_EPISODES).select('outline,created_at').eq('user_id', userId).eq('status', 'ready').order('id').range(f, t));
  const out: Asked[] = [];
  for (const e of eps) {
    const plan = e.outline?.planner === 'v2' ? e.outline.plan : null;
    if (!plan) continue;
    if (plan.reflection?.whyId) out.push({ arm: 'why', id: `why:${plan.reflection.whyId}`, at: e.created_at });
    if (plan.hypothesis?.id) out.push({ arm: `hypothesis:${plan.hypothesis.framework}`, id: `hypothesis:${plan.hypothesis.id}`, at: e.created_at });
    for (const i of (plan.items ?? []) as Array<{ id: string; register: string; facts?: { domainId?: string } }>) {
      if (i.register === 'asked' && i.id.startsWith('answer:')) out.push({ arm: `answer:${i.facts?.domainId ?? 'unknown'}`, id: i.id, at: e.created_at });
    }
  }
  return out;
}

/** Which of those the person responded to, by their own action only: a yes or no to a hypothesis, a verdict on an answer, a why they rejected. (A why going live is the promoter's doing, not theirs.) */
export async function readAnswered(userId: string, db: typeof supabase = supabase): Promise<Set<string>> {
  const out = new Set<string>();
  const { data: ans } = await db.from(Tables.QUESTION_ANSWERS).select('id').eq('user_id', userId).not('verdict_at', 'is', null).limit(1000);
  for (const a of (ans ?? []) as Array<{ id: string }>) out.add(`answer:${a.id}`);
  const { data: hyp } = await db.from('hypotheses').select('id').eq('user_id', userId).in('status', ['confirmed', 'declined']).limit(1000);
  for (const h of (hyp ?? []) as Array<{ id: string }>) out.add(`hypothesis:${h.id}`);
  const { data: whys } = await db.from(Tables.BEHAVIOR_PATTERN_WHYS).select('id').eq('user_id', userId).eq('status', 'user_rejected').limit(1000);
  for (const w of (whys ?? []) as Array<{ id: string }>) out.add(`why:${w.id}`);
  return out;
}

type Snapshot = { at: string; arms: ArmStat[] };

/** Recompute and keep the last five snapshots, so any change is visible and can be rolled back. */
export async function refreshLearning(userId: string, options: { db?: typeof supabase; now?: Date } = {}): Promise<Snapshot> {
  const db = options.db ?? supabase;
  const snap: Snapshot = { at: (options.now ?? new Date()).toISOString(), arms: armStats(await readAsked(userId, db), await readAnswered(userId, db)) };
  const { data } = await db.from(Tables.USER_PREFERENCES).select('id,metadata').eq('user_id', userId).maybeSingle();
  const row = data as { id: string; metadata: Record<string, any> | null } | null;
  const metadata = row?.metadata ?? {};
  const history: Snapshot[] = [snap, ...((metadata.learning?.history ?? []) as Snapshot[])].slice(0, 5);
  const next = { ...metadata, learning: { current: snap, history } };
  const { error } = row ? await db.from(Tables.USER_PREFERENCES).update({ metadata: next }).eq('id', row.id) : await db.from(Tables.USER_PREFERENCES).insert({ user_id: userId, metadata: next });
  if (error) throw new Error(`refreshLearning: ${error.message}`);
  return snap;
}

export async function readLearning(userId: string, db: typeof supabase = supabase): Promise<{ current: Snapshot | null; history: Snapshot[] }> {
  const { data } = await db.from(Tables.USER_PREFERENCES).select('metadata').eq('user_id', userId).maybeSingle();
  const l = (data as { metadata?: Record<string, any> } | null)?.metadata?.learning;
  return { current: l?.current ?? null, history: l?.history ?? [] };
}
