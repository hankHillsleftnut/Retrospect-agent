/**
 * Daily summaries: the shape of each day, per domain (W3.1, design change C8).
 *
 * Pure. Takes the day's items as stored and returns one summary per local day
 * and domain. The day is the person's local day: a 1am event belongs to the
 * night before it only if the person's clock says so, so times are read with
 * the offset the source recorded (calendar carries it) or the person's usual
 * offset otherwise.
 *
 * What each domain can honestly say:
 *   calendar   events, hours booked, with others, declined, first and last time
 *   own_words  entries and how much was written: the habit of reflecting
 *   mail       received, sent, automated
 *   content    subscriptions (dated). Liked videos are NOT dated by the API --
 *              their date is when the video was published -- so they are left
 *              out of daily counts rather than placed on the wrong day.
 *   health, screen_time
 *              the labelled readings ("Steps: 8,412") of the day's latest
 *              sync. A zero is "not recorded", never a measurement: a passive
 *              sensor can't tell "you did none" from "I saw nothing" (see
 *              health-summary.ts, 18 Oct: 746 nights of "0 hours sleep").
 */

import { normalizeHealthSummary } from '../pipelines/health-summary';
import { TIME_CATEGORIES, categoriseEvent, type TimeCategory } from './time-categories';

export type CategoryCache = Map<string, { category: TimeCategory; decided_by: string }>;
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export type Domain = 'calendar' | 'own_words' | 'mail' | 'content' | 'health' | 'screen_time';

export interface SummaryItem {
  id: string;
  content_type: string;
  created_at: string;
  trust_class?: string | null;
  metadata?: Record<string, unknown> | null;
  /** From the source item, when there is one. */
  occurred_at?: string | null;
  normalized_data?: Record<string, unknown> | null;
  /** Length of the text, for own words. Never the text itself. */
  chars?: number;
  /** The text, for health and screen time only: labelled readings are parsed from it. */
  text?: string;
}

export interface DailySummary {
  day: string;
  domain: Domain;
  metrics: Record<string, number | string | null>;
  items: number;
  source_ids: string[];
}

const OWN_WORDS = new Set(['journal_entry', 'voice_recording', 'voice_journal', 'text_entry', 'conversation', 'video_journal']);

/** "+HH:MM" style offset in minutes, from an ISO string that carries one. */
export function offsetMinutes(iso: string): number | null {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  if (!m) return iso.endsWith('Z') ? 0 : null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** The person's usual offset: the most common one their calendar records. */
export function usualOffset(items: SummaryItem[]): number {
  const counts = new Map<number, number>();
  for (const i of items) {
    const start = i.normalized_data?.start;
    if (typeof start !== 'string' || i.normalized_data?.all_day) continue;
    const o = offsetMinutes(start);
    if (o !== null && !start.endsWith('Z')) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  let best = 0, n = 0;
  for (const [o, c] of counts) if (c > n) { best = o; n = c; }
  return best;
}

/** Local date and minutes past midnight for an instant, at an offset. */
export function localTime(iso: string, offset: number): { day: string; minute: number } {
  const t = new Date(new Date(iso).getTime() + offset * 60_000);
  return { day: t.toISOString().slice(0, 10), minute: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function domainOf(i: SummaryItem): Domain | null {
  if (i.content_type === 'calendar') return 'calendar';
  if (OWN_WORDS.has(i.content_type) && i.trust_class !== 'automated') return 'own_words';
  if (i.content_type === 'gmail') return 'mail';
  if (i.content_type === 'youtube' && i.metadata?.relationship === 'subscribed_to') return 'content';
  if (i.content_type === 'healthkit') return 'health';
  if (i.content_type === 'screen_time') return 'screen_time';
  return null;
}

export function summariseDays(items: SummaryItem[], offset = usualOffset(items), categories?: CategoryCache): DailySummary[] {
  const groups = new Map<string, { day: string; domain: Domain; items: SummaryItem[] }>();
  for (const i of items) {
    const domain = domainOf(i);
    if (!domain) continue;
    let day: string;
    if (domain === 'calendar') {
      const start = i.normalized_data?.start;
      if (typeof start !== 'string') continue;
      day = i.normalized_data?.all_day ? start.slice(0, 10) : localTime(start, offsetMinutes(start) ?? offset).day;
    } else if ((domain === 'health' || domain === 'screen_time') && typeof i.metadata?.sync_day === 'string') {
      // A daily summary names its own day; trust that over when it was synced.
      day = String(i.metadata.sync_day).slice(0, 10);
    } else {
      day = localTime(i.occurred_at ?? i.created_at, offset).day;
    }
    const key = `${day}|${domain}`;
    if (!groups.has(key)) groups.set(key, { day, domain, items: [] });
    groups.get(key)!.items.push(i);
  }

  return [...groups.values()].map(({ day, domain, items: its }) => ({
    day, domain, items: its.length, source_ids: its.map((i) => i.id).sort(),
    metrics: metricsFor(domain, its, offset, categories),
  })).sort((a, b) => a.day.localeCompare(b.day) || a.domain.localeCompare(b.domain));
}

function metricsFor(domain: Domain, its: SummaryItem[], offset: number, categories?: CategoryCache): DailySummary['metrics'] {
  if (domain === 'calendar') {
    const timed = its.filter((i) => !i.normalized_data?.all_day && typeof i.normalized_data?.start === 'string');
    // Every event not declined. "Free" vs "busy" is about availability, not
    // activity: people mark errands, travel and gym as free so others can still
    // book them, and that is still where the time went (found 19 Oct: all 7
    // events the model placed were marked free, so none showed up).
    const attended = timed.filter((i) => i.normalized_data?.my_response !== 'declined');
    let minutes = 0;
    const starts: number[] = [], ends: number[] = [];
    const byCategory = new Map<string, number>();
    for (const i of attended) {
      const s = String(i.normalized_data!.start), e = typeof i.normalized_data?.end === 'string' ? String(i.normalized_data.end) : s;
      const m = Math.max(0, (new Date(e).getTime() - new Date(s).getTime()) / 60_000);
      minutes += m;
      const c = categoriseEvent({ title: i.normalized_data?.title as string | undefined, attendee_count: Number(i.normalized_data?.attendee_count ?? 0) }, categories);
      byCategory.set(c, (byCategory.get(c) ?? 0) + m);
      starts.push(localTime(s, offsetMinutes(s) ?? offset).minute);
      ends.push(localTime(e, offsetMinutes(e) ?? offset).minute);
    }
    return {
      events: its.length,
      hours_booked: Math.round((minutes / 60) * 10) / 10,
      with_others: attended.filter((i) => Number(i.normalized_data?.attendee_count ?? 0) > 0).length,
      declined: timed.filter((i) => i.normalized_data?.my_response === 'declined').length,
      all_day: its.length - timed.length,
      first_start: starts.length ? hhmm(Math.min(...starts)) : null,
      last_end: ends.length ? hhmm(Math.max(...ends)) : null,
      // Where the booked time went (W3.5); these add up to hours_booked.
      ...Object.fromEntries(TIME_CATEGORIES.filter((c) => byCategory.has(c)).map((c) => [`hours_${c}`, Math.round((byCategory.get(c)! / 60) * 100) / 100])),
    };
  }
  if (domain === 'own_words') {
    const mins = its.map((i) => localTime(i.created_at, offset).minute);
    return {
      entries: its.length,
      chars: its.reduce((n, i) => n + (i.chars ?? 0), 0),
      first_at: hhmm(Math.min(...mins)),
      last_at: hhmm(Math.max(...mins)),
    };
  }
  if (domain === 'mail') {
    const labels = (i: SummaryItem) => (Array.isArray(i.metadata?.labels) ? (i.metadata!.labels as string[]) : []);
    return {
      received: its.filter((i) => !labels(i).includes('SENT')).length,
      sent: its.filter((i) => labels(i).includes('SENT')).length,
      automated: its.filter((i) => i.trust_class === 'automated').length,
    };
  }
  if (domain === 'health' || domain === 'screen_time') {
    // Synced twice that day: the latest sync is the day's reading.
    const latest = [...its].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]!;
    return labelledReadings(latest.text ?? '');
  }
  return { subscribed: its.length };
}

/**
 * "Steps: 8,412" -> { steps: 8412 }. Zero readings are dropped: not recorded.
 * Units are kept in the key ("sleep_hours") so a number never loses its meaning.
 */
export function labelledReadings(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of normalizeHealthSummary(text).split('\n')) {
    const m = /^\s*([A-Za-z][A-Za-z ()/-]*?)\s*:\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z%]+)?\s*$/.exec(line);
    if (!m) continue;
    const value = Number(m[2]!.replace(/,/g, ''));
    if (!Number.isFinite(value) || value === 0) continue;
    const key = [m[1], m[3]].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    out[key] = value;
  }
  return out;
}

// ── Building them ─────────────────────────────────────────────────────────────


/** Lookups go in chunks: hundreds of ids in one URL is a "Bad Request" (#56). */
const CHUNK = 100;
const TEXT_DOMAINS = new Set(['healthkit', 'screen_time']);

/**
 * Rebuild one person's summaries for the last `days` days. Summaries are
 * derived, never claims: each day in the window is recomputed from its items,
 * and a day whose items are gone loses its row.
 */
export async function rebuildDailySummaries(userId: string, days = 120, db: typeof supabase = supabase, now = new Date()): Promise<{ days: number; rows: number }> {
  const { days: d, rows } = await rebuildDailySummariesWithDetail(userId, days, db, now);
  return { days: d, rows };
}

/** As rebuildDailySummaries, also handing back the summaries and item text (for record patterns, W3.2). */
export async function rebuildDailySummariesWithDetail(userId: string, days = 120, db: typeof supabase = supabase, now = new Date()): Promise<{ days: number; rows: number; summaries: DailySummary[]; textById: Map<string, string> }> {
  const since = new Date(now.getTime() - days * 864e5);
  const rows: Array<{ id: string; content_type: string; created_at: string; trust_class: string | null; metadata: Record<string, unknown> | null; source_item_id: string | null; content: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(Tables.RAW_CONTENT)
      .select('id,content_type,created_at,trust_class,metadata,source_item_id,content')
      .eq('user_id', userId).gte('created_at', new Date(since.getTime() - 365 * 864e5).toISOString())
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`rebuildDailySummaries: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < 1000) break;
  }

  const sourceIds = [...new Set(rows.map((r) => r.source_item_id).filter(Boolean) as string[])];
  const sources = new Map<string, { occurred_at: string | null; normalized_data: Record<string, unknown> | null }>();
  for (let i = 0; i < sourceIds.length; i += CHUNK) {
    const { data, error } = await db.from(Tables.SOURCE_ITEMS).select('id,occurred_at,normalized_data').in('id', sourceIds.slice(i, i + CHUNK));
    if (error) throw new Error(`rebuildDailySummaries sources: ${error.message}`);
    for (const s of (data ?? []) as Array<{ id: string; occurred_at: string | null; normalized_data: Record<string, unknown> | null }>) sources.set(s.id, s);
  }

  const items: SummaryItem[] = rows.map((r) => {
    const src = r.source_item_id ? sources.get(r.source_item_id) : undefined;
    return {
      id: r.id, content_type: r.content_type, created_at: r.created_at, trust_class: r.trust_class, metadata: r.metadata,
      occurred_at: src?.occurred_at ?? null, normalized_data: src?.normalized_data ?? null,
      chars: r.content?.length ?? 0,
      text: TEXT_DOMAINS.has(r.content_type) ? r.content ?? '' : undefined,
    };
  });

  const { data: cachedRows } = await db.from(Tables.EVENT_CATEGORIES).select('title_key,category,decided_by').eq('user_id', userId);
  const categories: CategoryCache = new Map(((cachedRows ?? []) as Array<{ title_key: string; category: TimeCategory; decided_by: string }>)
    .map((r) => [r.title_key, { category: r.category, decided_by: r.decided_by }]));

  const firstDay = since.toISOString().slice(0, 10);
  const summaries = summariseDays(items, usualOffset(items), categories).filter((d) => d.day >= firstDay);
  const { error: delError } = await db.from(Tables.DAILY_SUMMARIES).delete().eq('user_id', userId).gte('day', firstDay);
  if (delError) throw new Error(`rebuildDailySummaries clear: ${delError.message}`);
  for (let i = 0; i < summaries.length; i += CHUNK) {
    const { error } = await db.from(Tables.DAILY_SUMMARIES).insert(summaries.slice(i, i + CHUNK).map((d) => ({ user_id: userId, ...d, built_at: now.toISOString() })));
    if (error) throw new Error(`rebuildDailySummaries write: ${error.message}`);
  }
  const textById = new Map(rows.map((r) => [r.id, r.content ?? '']));
  return { days: new Set(summaries.map((d) => d.day)).size, rows: summaries.length, summaries, textById };
}
