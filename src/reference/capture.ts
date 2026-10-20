/**
 * Every link the person sends becomes a reference item, with the words around
 * it as its reason (R1.1, goal 23: "findable by your reason").
 *
 * Calibrated (approach-calibration.md, R1): the value of a saved link is
 * finding it when it's needed, and the reason is what it's found by. The
 * note stays the person's words; the page is reference, never evidence about
 * them, and lives apart from claims.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { selectAll } from '../db/paged';
import { SENT_TYPES } from '../planner/daily';

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

export interface CapturedLink { url: string; intent: string | null }

/** Links in a message, each with the message's own words as its reason. Pure. */
export function extractLinks(text: string): CapturedLink[] {
  const urls = [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')))];
  if (!urls.length) return [];
  const words = text.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim();
  return urls.map((url) => ({ url, intent: words || null }));
}

/** Capture links from what the person sent in the last `days` days. Safe to repeat. */
export async function captureReferences(userId: string, days = 14, db: typeof supabase = supabase, now = new Date()): Promise<{ scanned: number; captured: number }> {
  const since = new Date(now.getTime() - days * 864e5).toISOString();
  const rows = await selectAll<{ id: string; content: string | null }>((f, t) => db.from(Tables.RAW_CONTENT)
    .select('id,content').eq('user_id', userId).in('content_type', [...SENT_TYPES]).gte('created_at', since).ilike('content', '%http%').order('id').range(f, t));
  const items = rows.flatMap((r) => extractLinks(r.content ?? '').map((l) => ({ user_id: userId, raw_content_id: r.id, url: l.url, intent: l.intent })));
  if (items.length) {
    const { error } = await db.from(Tables.REFERENCE_ITEMS).upsert(items, { onConflict: 'raw_content_id,url', ignoreDuplicates: true });
    if (error) throw new Error(`captureReferences: ${error.message}`);
  }
  return { scanned: rows.length, captured: items.length };
}
