/**
 * Appetite (goal 22): how boldly the brain may speak to this person, as a
 * transparent ladder, not a score. Starts at 0, is earned upward slowly,
 * drops on any discomfort, and the person's own setting always wins.
 * See approach-calibration.md, goals 22 and 9.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export type Level = 0 | 1 | 2 | 3;
export const LEVELS: Record<Level, string> = {
  0: 'Just what happened: facts, patterns, what you said vs what you did',
  1: 'Gentle questions: one question about why, now and then',
  2: 'Honest observations: gaps named plainly, guesses asked as questions',
  3: "Don't hold back: direct challenge, always from evidence",
};

export interface Signal { kind: 'engaged' | 'discomfort'; at: string; what: string }
export interface Reading { level: Level; source: 'stated' | 'inferred'; reasons: string[] }

const DAY = 864e5;
export const RISE_AFTER = 2;      // engagement signals in the last 14 days, with no discomfort
export const RISE_WINDOW_DAYS = 14;
export const DROP_WINDOW_DAYS = 7;

/** Pure: the next inferred level from the last one and recent behaviour. Asymmetric on purpose. */
export function inferLevel(previous: Level, signals: Signal[], now: Date): { level: Level; reasons: string[] } {
  const within = (days: number) => signals.filter((s) => now.getTime() - new Date(s.at).getTime() <= days * DAY);
  const discomfort = within(DROP_WINDOW_DAYS).filter((s) => s.kind === 'discomfort');
  if (discomfort.length) {
    const level = Math.max(0, previous - 1) as Level;
    return { level, reasons: [`down to ${level}: ${discomfort.map((d) => d.what).join('; ')}`] };
  }
  const engaged = within(RISE_WINDOW_DAYS).filter((s) => s.kind === 'engaged');
  const discomfortRecent = within(RISE_WINDOW_DAYS).some((s) => s.kind === 'discomfort');
  if (engaged.length >= RISE_AFTER && !discomfortRecent && previous < 3) {
    const level = (previous + 1) as Level;
    return { level, reasons: [`up to ${level}: ${engaged.slice(0, 3).map((e) => e.what).join('; ')}`] };
  }
  return { level: previous, reasons: [`stays at ${previous}: ${engaged.length} engagement signal(s) in ${RISE_WINDOW_DAYS} days, need ${RISE_AFTER}`] };
}

/** Pure: stated always outranks inferred. */
export function effective(stored: { stated?: Level | null; inferred?: Level | null; reasons?: string[] } | null | undefined): Reading {
  if (stored?.stated != null) return { level: stored.stated, source: 'stated', reasons: ['you chose this'] };
  return { level: (stored?.inferred ?? 0) as Level, source: 'inferred', reasons: stored?.reasons ?? ['the starting point: facts and patterns only'] };
}

type Stored = { stated?: Level | null; inferred?: Level; reasons?: string[]; readAt?: string; lastRaisedAt?: string };

async function load(userId: string, db: typeof supabase): Promise<{ id: string | null; metadata: Record<string, unknown> }> {
  const { data } = await db.from(Tables.USER_PREFERENCES).select('id,metadata').eq('user_id', userId).maybeSingle();
  const r = data as { id: string; metadata: Record<string, unknown> | null } | null;
  return { id: r?.id ?? null, metadata: r?.metadata ?? {} };
}

async function save(userId: string, appetite: Stored, db: typeof supabase): Promise<void> {
  const { id, metadata } = await load(userId, db);
  const next = { ...metadata, appetite };
  const { error } = id
    ? await db.from(Tables.USER_PREFERENCES).update({ metadata: next }).eq('id', id)
    : await db.from(Tables.USER_PREFERENCES).insert({ user_id: userId, metadata: next });
  if (error) throw new Error(`appetite save: ${error.message}`);
}

export async function readAppetite(userId: string, db: typeof supabase = supabase): Promise<Reading> {
  return effective((await load(userId, db)).metadata.appetite as Stored | undefined);
}

/** The person sets it (or clears it with null, handing back to inference). */
export async function setStatedAppetite(userId: string, level: Level | null, db: typeof supabase = supabase): Promise<Reading> {
  const stored = ((await load(userId, db)).metadata.appetite ?? {}) as Stored;
  await save(userId, { ...stored, stated: level }, db);
  return readAppetite(userId, db);
}

/** Behaviour since the last reading: confirmations and answers engage; rejections and low ratings are discomfort. */
export async function readSignals(userId: string, since: string, db: typeof supabase = supabase): Promise<Signal[]> {
  const out: Signal[] = [];
  const { data: verdicts } = await db.from(Tables.QUESTION_ANSWERS).select('user_verdict,verdict_at').eq('user_id', userId).gte('verdict_at', since).limit(200);
  for (const v of (verdicts ?? []) as Array<{ user_verdict: string | null; verdict_at: string }>) {
    if (v.user_verdict === 'confirmed') out.push({ kind: 'engaged', at: v.verdict_at, what: 'you confirmed something it asked' });
    if (v.user_verdict === 'rejected') out.push({ kind: 'discomfort', at: v.verdict_at, what: 'you rejected something it said' });
  }
  const { data: whys } = await db.from(Tables.BEHAVIOR_PATTERN_WHYS).select('retired_at').eq('user_id', userId).eq('status', 'user_rejected').gte('retired_at', since).limit(50);
  for (const w of (whys ?? []) as Array<{ retired_at: string }>) out.push({ kind: 'discomfort', at: w.retired_at, what: 'you rejected a guess about why' });
  // Goal 21: a declined hypothesis is a signal to ease off; a confirmed one, that it landed.
  const { data: hyps } = await db.from('hypotheses').select('status,status_at').eq('user_id', userId).in('status', ['confirmed', 'declined']).gte('status_at', since).limit(50);
  for (const h of (hyps ?? []) as Array<{ status: string; status_at: string }>) {
    out.push(h.status === 'confirmed' ? { kind: 'engaged', at: h.status_at, what: 'you recognised something it wondered' } : { kind: 'discomfort', at: h.status_at, what: 'you declined something it wondered' });
  }
  const { data: ratings } = await db.from(Tables.EPISODE_FEEDBACK).select('rating,created_at').eq('user_id', userId).gte('created_at', since).not('rating', 'is', null).limit(50);
  for (const r of (ratings ?? []) as Array<{ rating: number; created_at: string }>) {
    if (r.rating <= 2) out.push({ kind: 'discomfort', at: r.created_at, what: `you rated an episode ${r.rating}/5` });
    if (r.rating >= 4) out.push({ kind: 'engaged', at: r.created_at, what: `you rated an episode ${r.rating}/5` });
  }
  return out;
}

/** Daily: re-read the inferred level. The stated level is never touched. */
export async function refreshAppetite(userId: string, options: { db?: typeof supabase; now?: Date } = {}): Promise<Reading> {
  const db = options.db ?? supabase;
  const now = options.now ?? new Date();
  const stored = ((await load(userId, db)).metadata.appetite ?? {}) as Stored;
  const signals = await readSignals(userId, new Date(now.getTime() - RISE_WINDOW_DAYS * DAY).toISOString(), db);
  // A rise needs a full window of fresh evidence: signals counted for one raise can't count for the next.
  const fresh = stored.lastRaisedAt ? signals.filter((s) => s.kind === 'discomfort' || s.at > stored.lastRaisedAt!) : signals;
  const next = inferLevel((stored.inferred ?? 0) as Level, fresh, now);
  const raised = next.level > (stored.inferred ?? 0);
  await save(userId, { ...stored, inferred: next.level, reasons: next.reasons, readAt: now.toISOString(), ...(raised ? { lastRaisedAt: now.toISOString() } : {}) }, db);
  return readAppetite(userId, db);
}
