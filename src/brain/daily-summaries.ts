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

export function summariseDays(items: SummaryItem[], offset = usualOffset(items)): DailySummary[] {
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
    metrics: metricsFor(domain, its, offset),
  })).sort((a, b) => a.day.localeCompare(b.day) || a.domain.localeCompare(b.domain));
}

function metricsFor(domain: Domain, its: SummaryItem[], offset: number): DailySummary['metrics'] {
  if (domain === 'calendar') {
    const timed = its.filter((i) => !i.normalized_data?.all_day && typeof i.normalized_data?.start === 'string');
    const attended = timed.filter((i) => i.normalized_data?.my_response !== 'declined' && i.normalized_data?.busy !== false);
    let minutes = 0;
    const starts: number[] = [], ends: number[] = [];
    for (const i of attended) {
      const s = String(i.normalized_data!.start), e = typeof i.normalized_data?.end === 'string' ? String(i.normalized_data.end) : s;
      minutes += Math.max(0, (new Date(e).getTime() - new Date(s).getTime()) / 60_000);
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
