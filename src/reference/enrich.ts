/**
 * Enrich each saved link: title, a short summary, topics from a fixed list
 * (R1.2). Calibrated: fetch on save, summarise, tags from a FIXED vocabulary
 * so they stay consistent (Karakeep's pattern, approach-calibration.md R1).
 *
 * The fetch is locked down (fetching arbitrary URLs from a server is a classic
 * hole): http/https on standard ports only; the host's addresses are resolved
 * and any private, loopback, link-local or metadata address is refused,
 * re-checked on every redirect (at most 3); 8 s and 1.5 MB at most; text only.
 * Known gap: DNS rebinding (a host resolving differently at fetch time); the
 * fix is pinning the checked address. Low risk: only links the person sent.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';

export const TOPICS = ['work', 'startups', 'fundraising', 'design', 'engineering', 'ai', 'health', 'fitness', 'sleep', 'food',
  'relationships', 'family', 'money', 'career', 'learning', 'writing', 'music', 'film', 'travel', 'home', 'mindset', 'productivity', 'news', 'other'] as const;

const MAX_BYTES = 1_500_000;
/** About a long essay. Longer pages are read up to here, in sections (R1.2b). */
export const MAX_TEXT = 60_000;
export const SECTION = 6_000;
const TIMEOUT_MS = 8000;

/** Is this an address we must never fetch from? Pure. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:') && isPrivateAddress(x.slice(7));
}

export async function checkUrl(raw: string, resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address)): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http and https');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('non-standard port');
  if (u.username || u.password) throw new Error('credentials in URL');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : await resolve(host);
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new Error('private or unresolvable address');
  return u;
}

/** Title and readable text from a page. Pure. */
export function readPage(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() || null;
  const text = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  return { title, text: text.slice(0, MAX_TEXT) };
}

export async function safeFetch(raw: string, fetcher: typeof fetch = fetch, resolve?: (host: string) => Promise<string[]>): Promise<string> {
  let url = await checkUrl(raw, resolve);
  for (let hop = 0; hop <= 3; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetcher(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'RetrospectBot/1.0 (+reading a link its owner saved)' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = await checkUrl(new URL(res.headers.get('location')!, url).toString(), resolve); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (!/text\/(html|plain)|application\/xhtml/.test(type)) throw new Error(`not a text page (${type})`);
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_BYTES) throw new Error('page too large');
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) throw new Error('page too large');
      return new TextDecoder().decode(buf);
    } finally { clearTimeout(timer); }
  }
  throw new Error('too many redirects');
}

export const ENRICH_SYSTEM = `You describe a web page someone saved. Reply with JSON only:
{"summary":"<one or two plain sentences on what the page is>","topics":["<1 to 3 from this list only: ${TOPICS.join(', ')}>"]}
Describe the page, never the person who saved it.`;

export const SECTION_SYSTEM = `You read one part of a longer web page. Reply with JSON only: {"summary":"<one sentence on what this part says>"}`;

/** Keep only listed topics, at most three. Pure. */
export function vetTopics(t: unknown): string[] {
  return Array.isArray(t) ? [...new Set(t.map(String).map((x) => x.toLowerCase().trim()).filter((x) => (TOPICS as readonly string[]).includes(x)))].slice(0, 3) : [];
}

export async function enrichPending(userId: string, options: { db?: typeof supabase; fetcher?: typeof fetch; resolve?: (h: string) => Promise<string[]>; limit?: number;
  model?: (s: string, p: string) => Promise<{ data: { summary?: unknown; topics?: unknown }; usage: ClaudeUsage }> } = {}) {
  const db = options.db ?? supabase;
  const model = options.model ?? ((s, p) => claudeJsonCompletion<{ summary?: unknown; topics?: unknown }>(s, p, { model: config.anthropic.timeCategoryModel, maxTokens: 300 }));
  const { data } = await db.from(Tables.REFERENCE_ITEMS).select('id,url,intent').eq('user_id', userId).eq('status', 'new').order('created_at').limit(options.limit ?? 20);
  const tally = { enriched: 0, failed: 0, unsafe: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  for (const item of (data ?? []) as Array<{ id: string; url: string; intent: string | null }>) {
    let update: Record<string, unknown>;
    try {
      const page = readPage(await safeFetch(item.url, options.fetcher, options.resolve));
      // A long page is read in full: each section noted, then described as a whole.
      let body = page.text;
      if (page.text.length > SECTION) {
        const notes: string[] = [];
        for (let i = 0; i < page.text.length; i += SECTION) {
          const part = await model(SECTION_SYSTEM, page.text.slice(i, i + SECTION));
          tally.usage.inputTokens += part.usage.inputTokens; tally.usage.outputTokens += part.usage.outputTokens;
          if (typeof part.data.summary === 'string') notes.push(part.data.summary);
        }
        body = `NOTES ON EACH PART OF THE PAGE, IN ORDER:\n${notes.map((n, k) => `${k + 1}. ${n}`).join('\n')}`;
      }
      const r = await model(ENRICH_SYSTEM, `URL: ${item.url}\nTITLE: ${page.title ?? '(none)'}\n\n${body}`);
      tally.usage.inputTokens += r.usage.inputTokens; tally.usage.outputTokens += r.usage.outputTokens;
      update = { status: 'enriched', title: page.title, summary: typeof r.data.summary === 'string' ? r.data.summary.slice(0, 500) : null, topics: vetTopics(r.data.topics), fetched_at: new Date().toISOString() };
      tally.enriched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const unsafe = /private|only http|non-standard port|credentials/.test(msg);
      update = { status: unsafe ? 'unsafe' : 'failed', fetched_at: new Date().toISOString() };
      unsafe ? tally.unsafe++ : tally.failed++;
    }
    await db.from(Tables.REFERENCE_ITEMS).update(update).eq('id', item.id);
  }
  return tally;
}
