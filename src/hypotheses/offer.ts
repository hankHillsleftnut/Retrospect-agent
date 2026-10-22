/**
 * Goal 21: when, and which, hypothesis is offered. Only when the founder's
 * dial says speak and the person's appetite is high enough; at most one per
 * episode (it takes the asked slot); offered at most twice, 14 days apart;
 * and only while everything it rests on is still believed.
 */

import { supabase } from '../db/supabase';
import type { UnderstandingContract } from '../understanding/read';
import { evidenceLines } from './propose';
import { FRAMEWORKS, type FrameworkId } from './validate';

export interface HypothesisDial { speak: boolean; min_appetite: number; per_episode: number; expire_days: number }
export const DIAL_DEFAULT: HypothesisDial = { speak: false, min_appetite: 2, per_episode: 1, expire_days: 30 };

/** The founder's dial (product_dials), changed without a deploy. Missing or unreadable means off. */
export async function readHypothesisDial(db: typeof supabase = supabase): Promise<HypothesisDial> {
  const { data, error } = await db.from('product_dials').select('value').eq('key', 'hypotheses').maybeSingle();
  if (error || !data) return DIAL_DEFAULT;
  return { ...DIAL_DEFAULT, ...((data as { value: Partial<HypothesisDial> }).value ?? {}) };
}

export interface Offer { id: string; question: string; framework: string; frameworkName: string; rationale: string; evidence: string[] }
type Row = { id: string; question: string; framework: string; rationale: string | null; supports: Array<{ kind: string; id: string }>; offered_count: number; last_offered_at: string | null; status: string; created_at: string };

/** Pure: which stored hypothesis may be offered now, with the believed claims it rests on. */
export function chooseOffer(rows: Row[], c: UnderstandingContract, appetite: number, dial: HypothesisDial, now: Date): Offer | null {
  if (!dial.speak || appetite < dial.min_appetite || dial.per_episode < 1) return null;
  const lines = new Map(evidenceLines(c).map((l) => [`${l.kind}:${l.id}`, l.text]));
  for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!['stored', 'offered'].includes(r.status) || r.offered_count >= 2) continue;
    if (r.last_offered_at && now.getTime() - new Date(r.last_offered_at).getTime() < 14 * 864e5) continue;
    const evidence = r.supports.map((s) => lines.get(`${s.kind}:${s.id}`));
    // Everything it rests on must still be believed and spoken-of; otherwise it waits.
    if (evidence.some((e) => !e)) continue;
    return { id: r.id, question: r.question, framework: r.framework, frameworkName: FRAMEWORKS[r.framework as FrameworkId]?.name ?? r.framework, rationale: r.rationale ?? '', evidence: evidence as string[] };
  }
  return null;
}

export async function loadOfferable(userId: string, db: typeof supabase = supabase): Promise<Row[]> {
  // Newest first, no cap: the open set is small (guesses expire), and a cap without an
  // order could drop the newest. A query error is an error, not an empty list.
  const { data, error } = await db.from('hypotheses').select('id,question,framework,rationale,supports,offered_count,last_offered_at,status,created_at').eq('user_id', userId).in('status', ['stored', 'offered']).order('created_at', { ascending: false });
  if (error) throw new Error(`loadOfferable: ${error.message}`);
  return (data ?? []) as Row[];
}

export async function markOffered(userId: string, id: string, db: typeof supabase = supabase, now = new Date()): Promise<void> {
  const { data } = await db.from('hypotheses').select('offered_count').eq('id', id).eq('user_id', userId).maybeSingle();
  const n = ((data as { offered_count?: number } | null)?.offered_count ?? 0) + 1;
  await db.from('hypotheses').update({ status: 'offered', offered_count: n, last_offered_at: now.toISOString(), status_at: now.toISOString() }).eq('id', id).eq('user_id', userId);
}

/** "Yes" or "no" in one word. Only the person's yes ever promotes it (goal 21). */
export async function answerHypothesis(userId: string, id: string, verdict: 'yes' | 'no', db: typeof supabase = supabase, now = new Date()): Promise<{ status: string }> {
  const status = verdict === 'yes' ? 'confirmed' : 'declined';
  const { data, error } = await db.from('hypotheses').update({ status, status_at: now.toISOString() }).eq('id', id).eq('user_id', userId).in('status', ['stored', 'offered']).select('id');
  if (error) throw new Error(`answerHypothesis: ${error.message}`);
  if (!(data as unknown[] | null)?.length) throw new Error('answerHypothesis: no open hypothesis with that id for this person');
  return { status };
}

/** Unconfirmed past the dial's window: retired, never quietly kept. */
export async function expireHypotheses(userId: string, dial: HypothesisDial, db: typeof supabase = supabase, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - dial.expire_days * 864e5).toISOString();
  const { data } = await db.from('hypotheses').update({ status: 'expired', status_at: now.toISOString() }).eq('user_id', userId).in('status', ['stored', 'offered']).lt('created_at', cutoff).select('id');
  return ((data as unknown[] | null) ?? []).length;
}
