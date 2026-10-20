/**
 * YouTube watch history from Google Takeout (R1). YouTube's API has no watch
 * history at all, only likes, so the export is the only way in. Takeout gives
 * it as HTML by default or JSON if chosen; both are read. Ads Google slipped
 * into the history and removed videos are dropped. Each watch is stored as a
 * dated behaviour record (trust 'record'), with no model reading per video:
 * a history can hold tens of thousands of watches. Safe to import twice.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { chunks } from '../db/paged';

export interface Watch { videoId: string; title: string; channel: string | null; channelUrl: string | null; watchedAt: string }

const VIDEO_ID = /[?&]v=([A-Za-z0-9_-]{6,})/;
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\u202f/g, ' ').trim();

/** Pure: the JSON export (watch-history.json). */
export function parseTakeoutJson(text: string): Watch[] {
  const rows = JSON.parse(text) as Array<{ title?: string; titleUrl?: string; subtitles?: Array<{ name?: string; url?: string }>; time?: string; details?: Array<{ name?: string }> }>;
  const out: Watch[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.details?.some((d) => /ads/i.test(d.name ?? ''))) continue;          // "From Google Ads"
    const id = r.titleUrl?.match(VIDEO_ID)?.[1];
    if (!id || !r.time) continue;                                              // removed or private videos
    out.push({ videoId: id, title: decode((r.title ?? '').replace(/^Watched\s+/, '')), channel: r.subtitles?.[0]?.name ?? null, channelUrl: r.subtitles?.[0]?.url ?? null, watchedAt: new Date(r.time).toISOString() });
  }
  return out;
}

/** Pure: the default HTML export (watch-history.html). One "content-cell" per watch. */
export function parseTakeoutHtml(html: string): Watch[] {
  const out: Watch[] = [];
  const cells = html.split(/<div class="outer-cell/).slice(1);
  for (const cell of cells) {
    if (/From Google Ads/i.test(cell)) continue;
    const body = cell.match(/<div class="content-cell[^"]*">([\s\S]*?)<\/div>/)?.[1];
    if (!body || !/Watched/.test(body)) continue;
    const links = [...body.matchAll(/<a href="([^"]+)">([\s\S]*?)<\/a>/g)];
    const video = links.find((l) => VIDEO_ID.test(l[1]!));
    const id = video?.[1]!.match(VIDEO_ID)?.[1];
    if (!video || !id) continue;
    const channel = links.find((l) => /\/channel\/|\/@/.test(l[1]!));
    const parts = body.split('<br>').map((p) => decode(p.replace(/<[^>]+>/g, '')));
    const dateText = parts.reverse().find((p) => /\d{4}/.test(p) && /\d:\d\d/.test(p));
    const t = dateText ? Date.parse(dateText.replace(/\s[A-Z]{2,5}$/, '')) : NaN;
    if (Number.isNaN(t)) continue;
    out.push({ videoId: id, title: decode(video[2]!.replace(/<[^>]+>/g, '')), channel: channel ? decode(channel[2]!) : null, channelUrl: channel?.[1] ?? null, watchedAt: new Date(t).toISOString() });
  }
  return out;
}

export function parseTakeout(text: string): Watch[] {
  const t = text.trimStart();
  return t.startsWith('[') ? parseTakeoutJson(text) : parseTakeoutHtml(text);
}

const keyOf = (w: Watch) => `yt-watch:${w.videoId}:${w.watchedAt}`;

/** Store watches as dated records. Already-imported watches are skipped. */
export async function importWatches(userId: string, watches: Watch[], db: typeof supabase = supabase): Promise<{ added: number; skipped: number }> {
  const unique = [...new Map(watches.map((w) => [keyOf(w), w])).values()];
  let added = 0, skipped = 0;
  for (const part of chunks(unique, 200)) {
    const keys = part.map(keyOf);
    const { data: have } = await db.from(Tables.RAW_CONTENT).select('dedup_key').eq('user_id', userId).in('dedup_key', keys);
    const seen = new Set(((have ?? []) as Array<{ dedup_key: string }>).map((r) => r.dedup_key));
    const fresh = part.filter((w) => !seen.has(keyOf(w)));
    skipped += part.length - fresh.length;
    if (!fresh.length) continue;
    const { error } = await db.from(Tables.RAW_CONTENT).insert(fresh.map((w) => ({
      user_id: userId,
      content_type: 'youtube',
      content: `watched: ${w.title}${w.channel ? `\n${w.channel}` : ''}`,
      metadata: { source: 'youtube', relationship: 'watched', video_id: w.videoId, channel_title: w.channel, channel_url: w.channelUrl, import: 'google_takeout' },
      trust_class: 'record',
      // A record of attention, not words to read: counted and grouped, never sent through extraction.
      processing_status: 'completed',
      created_at: w.watchedAt,
      dedup_key: keyOf(w),
      dedup_strategy: 'explicit_key',
    })));
    if (error) throw new Error(`importWatches: ${error.message}`);
    added += fresh.length;
  }
  return { added, skipped };
}
