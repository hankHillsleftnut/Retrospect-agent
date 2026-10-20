/**
 * The daily brief's plan (D1.2).
 *
 * Founder, 20 Oct: "I'm going to send you links and information constantly,
 * and you can deliver it to me in a daily cadence." So the brief has two parts:
 *   inbox  everything they sent since the last brief, always, in full, first;
 *          never dropped for being below a bar (it's theirs, handed over).
 *   rest   the usual selection (W5.1) under the daily policy: today's
 *          calendar, what moved since the last brief, shifts; anything said in
 *          the last three briefs is discounted (novelty decays).
 * A day with nothing sent and nothing worth saying is quiet: a short brief.
 */

import type { UnderstandingContract } from '../understanding/read';
import { buildCandidates, type PlanItem } from './plan';
import { selectItems, POLICIES } from './select';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { selectAll, chunks } from '../db/paged';

/** Kinds of item a person SENDS (as opposed to passive syncs). */
export const SENT_TYPES = new Set(['text_entry', 'journal_entry', 'voice_recording', 'voice_journal', 'conversation', 'manual_journal', 'link', 'shared_link', 'reference', 'note']);

export interface InboxItem { id: string; contentType: string; at: string; preview: string; url: string | null }
export interface TodayEvent { id: string; title: string; start: string; end: string | null; withOthers: number }

/** A link saved earlier, brought back because it bears on something live (R1.4). */
export interface Resurfaced { id: string; url: string; title: string | null; summary: string | null; intent: string | null; savedAt: string; because: string }

export interface DailyPlan {
  inbox: InboxItem[];
  /** At most one, never in the last 14 days, saved at least a week ago. */
  resurface?: Resurfaced | null;
  today: TodayEvent[];
  items: PlanItem[];
  withheld: Array<{ id: string; why: string }>;
  quiet: boolean;
}

const URL_RE = /https?:\/\/[^\s)>\]]+/;

/** One sent item, as the brief shows it. Pure. */
export function toInbox(r: { id: string; content_type: string; created_at: string; content: string | null }): InboxItem {
  const text = (r.content ?? '').trim();
  return { id: r.id, contentType: r.content_type, at: r.created_at, preview: text.slice(0, 280), url: URL_RE.exec(text)?.[0] ?? null };
}

/**
 * Pick at most one saved link to bring back (R1.4). Calibrated: re-finding
 * happens through reminding, not browsing (approach-calibration.md, R1).
 * Eligible: saved >= 7 days ago, tied to an active goal or to a question that
 * moved since the last brief, and not brought back in the last 14 days.
 * The oldest eligible one wins. Pure.
 */
export function pickResurface(saved: Array<{ id: string; url: string; title: string | null; summary: string | null; intent: string | null; created_at: string; goal_ids: string[]; question_ids: number[] }>,
  live: { goalIds: Set<string>; movedQuestions: Set<number>; recentlyResurfaced: Set<string> }, now: Date): Resurfaced | null {
  const weekAgo = now.getTime() - 7 * 864e5;
  const eligible = saved
    .filter((r) => new Date(r.created_at).getTime() <= weekAgo && !live.recentlyResurfaced.has(r.id))
    .map((r) => {
      const goal = r.goal_ids.find((g) => live.goalIds.has(g));
      const q = r.question_ids.find((x) => live.movedQuestions.has(x));
      return goal || q ? { r, because: goal ? `goal:${goal}` : `question:${q}` } : null;
    })
    .filter((x): x is { r: (typeof saved)[number]; because: string } => !!x)
    .sort((a, b) => a.r.created_at.localeCompare(b.r.created_at));
  const pick = eligible[0];
  return pick ? { id: pick.r.id, url: pick.r.url, title: pick.r.title, summary: pick.r.summary, intent: pick.r.intent, savedAt: pick.r.created_at, because: pick.because } : null;
}

export function planDaily(c: UnderstandingContract, input: { inbox: InboxItem[]; today: TodayEvent[]; saidRecently: Set<string>; resurface?: Resurfaced | null }): DailyPlan {
  const built = buildCandidates(c).filter((b) => b.item.kind !== 'pattern' || b.candidate.moved);
  for (const b of built) if (input.saidRecently.has(b.candidate.id)) b.candidate.saidRecently = true;
  const sel = selectItems(built.map((b) => b.candidate), POLICIES.daily.maxItems);
  const byId = new Map(built.map((b) => [b.candidate.id, b.item]));
  const items = sel.selected.map((id) => byId.get(id)!);
  return {
    inbox: [...input.inbox].sort((a, b) => a.at.localeCompare(b.at)),
    resurface: input.resurface ?? null,
    today: [...input.today].sort((a, b) => a.start.localeCompare(b.start)),
    items,
    withheld: Object.entries(sel.excluded).map(([id, why]) => ({ id, why })),
    quiet: input.inbox.length === 0 && items.length === 0 && !input.resurface,
  };
}

// ── Gathering a day's inputs ─────────────────────────────────────────────────

export async function readDailyInputs(userId: string, db: typeof supabase = supabase, now = new Date()) {
  // Since the last brief (a quiet one counts), or the last day.
  const { data: last } = await db.from(Tables.DAILY_BRIEFS).select('created_at,items').eq('user_id', userId).order('created_at', { ascending: false }).limit(3);
  const briefs = (last ?? []) as Array<{ created_at: string; items: Array<{ planId?: string }> | null }>;
  const since = briefs[0]?.created_at ?? new Date(now.getTime() - 864e5).toISOString();
  const saidRecently = new Set(briefs.flatMap((b) => (b.items ?? []).map((i) => i.planId).filter(Boolean) as string[]));

  const sent = await selectAll<{ id: string; content_type: string; created_at: string; content: string | null }>((f, t) => db.from(Tables.RAW_CONTENT)
    .select('id,content_type,created_at,content').eq('user_id', userId).in('content_type', [...SENT_TYPES]).gt('created_at', since).order('created_at').range(f, t));

  // Today's calendar: events whose own local date (the offset they carry) is today.
  const today = now.toISOString().slice(0, 10);
  const cal = await selectAll<{ id: string; source_item_id: string | null }>((f, t) => db.from(Tables.RAW_CONTENT)
    .select('id,source_item_id').eq('user_id', userId).eq('content_type', 'calendar').order('id').range(f, t));
  const events: TodayEvent[] = [];
  for (const part of chunks(cal.filter((r) => r.source_item_id).map((r) => r.source_item_id!))) {
    const { data } = await db.from(Tables.SOURCE_ITEMS).select('id,normalized_data').in('id', part);
    for (const s of (data ?? []) as Array<{ id: string; normalized_data: { title?: string; start?: string; end?: string; my_response?: string; attendee_count?: number } | null }>) {
      const n = s.normalized_data;
      if (!n?.start || n.start.slice(0, 10) !== today || n.my_response === 'declined') continue;
      events.push({ id: s.id, title: n.title ?? '(no title)', start: n.start, end: n.end ?? null, withOthers: n.attendee_count ?? 0 });
    }
  }
  // R1.4: one saved link back, if one bears on something live.
  const { data: recentBriefs } = await db.from(Tables.DAILY_BRIEFS).select('items').eq('user_id', userId).gte('brief_date', new Date(now.getTime() - 14 * 864e5).toISOString().slice(0, 10));
  const recentlyResurfaced = new Set(((recentBriefs ?? []) as Array<{ items: Array<{ planId?: string }> | null }>).flatMap((b) => (b.items ?? []).map((i) => i.planId ?? '')).filter((p) => p.startsWith('saved:')).map((p) => p.slice(6)));
  const [{ data: savedRows }, { data: goalRows }, { data: moveRows }] = await Promise.all([
    db.from(Tables.REFERENCE_ITEMS).select('id,url,title,summary,intent,created_at,goal_ids,question_ids').eq('user_id', userId).eq('status', 'enriched').not('related_at', 'is', null).limit(500),
    db.from(Tables.GOALS).select('id').eq('user_id', userId).eq('status', 'active'),
    db.from(Tables.QUESTION_ANSWERS).select('question_id,last_moved_at').eq('user_id', userId).eq('status', 'active').gt('last_moved_at', since),
  ]);
  const resurface = pickResurface((savedRows ?? []) as never, {
    goalIds: new Set(((goalRows ?? []) as Array<{ id: string }>).map((g) => g.id)),
    movedQuestions: new Set(((moveRows ?? []) as Array<{ question_id: number }>).map((m) => m.question_id)),
    recentlyResurfaced,
  }, now);
  return { since, inbox: sent.map(toInbox), today: events, saidRecently, resurface };
}
