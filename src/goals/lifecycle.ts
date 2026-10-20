/**
 * Goals have a lifecycle (goal 7): January's marathon is not this week's topic.
 *
 * Founder's call, 19 Oct, declared before running:
 *  - Merge: goals more than 0.9 similar are one goal; the earliest stays, the
 *    others become "merged" and point to it.
 *  - Expire: a goal stated more than 90 days ago and not mentioned in the
 *    person's own writing in the last 90 days becomes "expired". (Its
 *    updated_at is NOT used: the system touches goals too, e.g. embeddings,
 *    so it says nothing about the person. Found by this file's test.) "Mentioned" = at least two of its
 *    distinctive words (or its only one) appear in an entry.
 *  - Nothing is deleted; every change is revivable and says why.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { cosine } from '../understanding/content-groups';

export const DUPLICATE = 0.9;
export const EXPIRE_DAYS = 90;
const STOP = new Set(['the', 'and', 'for', 'with', 'more', 'get', 'be', 'to', 'a', 'an', 'my', 'of', 'in', 'on', 'at', 'by', 'every', 'each', 'week', 'day', 'make', 'start', 'stop', 'keep', 'build', 'better', 'want', 'goal', 'into', 'from', 'that', 'this', 'your', 'have', 'less', 'than']);

export interface GoalRow { id: string; title: string; description: string | null; created_at: string; updated_at: string | null; vector: number[] | null; /** Set when the goal was revived ('stated again'): the 90 days restart from it. */ status_at?: string | null }

export function distinctiveWords(g: Pick<GoalRow, 'title'>): string[] {
  return [...new Set(g.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)))];
}

export function isMentioned(g: Pick<GoalRow, 'title'>, text: string): boolean {
  const words = distinctiveWords(g);
  if (!words.length) return false;
  const t = text.toLowerCase();
  const hits = words.filter((w) => new RegExp(`\\b${w}`).test(t)).length;
  return hits >= Math.min(2, words.length);
}

/** Pure: which goals merge into which, and which expire. */
export function planLifecycle(goals: GoalRow[], ownWords: Array<{ at: string; text: string }>, now: Date) {
  const sorted = [...goals].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const mergedInto = new Map<string, string>();
  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i]!;
    if (mergedInto.has(g.id) || !g.vector) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const h = sorted[j]!;
      if (!mergedInto.has(h.id) && h.vector && cosine(g.vector, h.vector) > DUPLICATE) mergedInto.set(h.id, g.id);
    }
  }
  const cutoff = now.getTime() - EXPIRE_DAYS * 864e5;
  const recent = ownWords.filter((w) => new Date(w.at).getTime() >= cutoff);
  const expire: string[] = [];
  const lastMentioned = new Map<string, string>();
  for (const g of sorted) {
    if (mergedInto.has(g.id)) continue;
    // A goal is kept alive by any of its copies being mentioned.
    const family = [g, ...sorted.filter((h) => mergedInto.get(h.id) === g.id)];
    const mention = recent.filter((w) => family.some((f) => isMentioned(f, w.text))).map((w) => w.at).sort().pop();
    if (mention) lastMentioned.set(g.id, mention);
    // Stated = first stated, or stated again (a revival sets status_at). Without
    // this, a goal the backend revives would expire again the next day (review, 19 Oct).
    const stated = Math.max(new Date(g.created_at).getTime(), g.status_at ? new Date(g.status_at).getTime() : 0);
    if (!mention && stated < cutoff) expire.push(g.id);
  }
  return { mergedInto, expire, lastMentioned };
}

const OWN_WORDS = ['journal_entry', 'voice_recording', 'voice_journal', 'text_entry', 'conversation', 'video_journal'];

export async function applyGoalLifecycle(userId: string, options: { dryRun?: boolean; now?: Date; db?: typeof supabase } = {}) {
  const db = options.db ?? supabase, now = options.now ?? new Date();
  const { data: rows, error } = await db.from(Tables.GOALS).select('id,title,description,created_at,updated_at,embedding,status,status_at').eq('user_id', userId).eq('status', 'active');
  if (error) throw new Error(`applyGoalLifecycle goals: ${error.message}`);
  const goals: GoalRow[] = ((rows ?? []) as unknown as Array<Omit<GoalRow, "vector"> & { embedding: unknown }>).map((r) => ({
    ...r, vector: Array.isArray(r.embedding) ? (r.embedding as number[]) : typeof r.embedding === 'string' ? JSON.parse(r.embedding) as number[] : null,
  }));
  const since = new Date(now.getTime() - EXPIRE_DAYS * 864e5).toISOString();
  const { data: words } = await db.from(Tables.RAW_CONTENT).select('created_at,content').eq('user_id', userId).in('content_type', OWN_WORDS).gte('created_at', since);
  const plan = planLifecycle(goals, ((words ?? []) as Array<{ created_at: string; content: string }>).map((w) => ({ at: w.created_at, text: w.content ?? '' })), now);
  const summary = { goals: goals.length, merged: plan.mergedInto.size, expired: plan.expire.length, remainActive: goals.length - plan.mergedInto.size - plan.expire.length, mentionedRecently: plan.lastMentioned.size };
  if (options.dryRun) return summary;

  const at = now.toISOString();
  for (const [id, into] of plan.mergedInto) {
    const { error: e } = await db.from(Tables.GOALS).update({ status: 'merged', merged_into: into, is_active: false, status_reason: `near-duplicate (> ${DUPLICATE} similar) of an earlier goal`, status_at: at }).eq('id', id);
    if (e) throw new Error(`applyGoalLifecycle merge: ${e.message}`);
  }
  for (const id of plan.expire) {
    const { error: e } = await db.from(Tables.GOALS).update({ status: 'expired', is_active: false, status_reason: `stated over ${EXPIRE_DAYS} days ago and not mentioned in your own words since`, status_at: at }).eq('id', id);
    if (e) throw new Error(`applyGoalLifecycle expire: ${e.message}`);
  }
  for (const [id, when] of plan.lastMentioned) await db.from(Tables.GOALS).update({ last_mentioned_at: when }).eq('id', id);
  return summary;
}
