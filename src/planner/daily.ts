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

export interface DailyPlan {
  inbox: InboxItem[];
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

export function planDaily(c: UnderstandingContract, input: { inbox: InboxItem[]; today: TodayEvent[]; saidRecently: Set<string> }): DailyPlan {
  const built = buildCandidates(c).filter((b) => b.item.kind !== 'pattern' || b.candidate.moved);
  for (const b of built) if (input.saidRecently.has(b.candidate.id)) b.candidate.saidRecently = true;
  const sel = selectItems(built.map((b) => b.candidate), POLICIES.daily.maxItems);
  const byId = new Map(built.map((b) => [b.candidate.id, b.item]));
  const items = sel.selected.map((id) => byId.get(id)!);
  return {
    inbox: [...input.inbox].sort((a, b) => a.at.localeCompare(b.at)),
    today: [...input.today].sort((a, b) => a.start.localeCompare(b.start)),
    items,
    withheld: Object.entries(sel.excluded).map(([id, why]) => ({ id, why })),
    quiet: input.inbox.length === 0 && items.length === 0,
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
  return { since, inbox: sent.map(toInbox), today: events, saidRecently };
}
