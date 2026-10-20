/**
 * Search, the way the founder wants it in v1 (20 Oct): "Hey, this is what we
 * found": a short written synthesis on top, the sources below, each openable.
 * Search your own experiences, your own mind, everything.
 *
 *   1. rewrite  the question into up to 3 keyword searches (natural questions
 *               rarely share words with what was written: "afraid" vs "fear")
 *   2. search   all of them plus the meaning search; merge; best 15 sources
 *   3. write    2-5 sentences, every claim citing [n]; or abstain plainly
 *   4. check    each sentence against only the sources it cites; cut the rest
 * A search that never says "nothing here" is a warning sign (research matrix R5).
 */

import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { guardSentences, type GuardModel } from '../writer/claim-guard';
import { searchPerson, type SearchHit } from './search';
import { supabase } from '../db/supabase';
import { chunks } from '../db/paged';

export interface SearchResult {
  query: string;
  summary: string;
  abstained: boolean;
  sources: Array<{ n: number; kind: SearchHit['kind']; id: string; date: string | null; snippet: string }>;
  cut: Array<{ sentence: string; reason: string }>;
  usage: { rewrite: ClaudeUsage; write: ClaudeUsage; guard: ClaudeUsage };
}

type Json<T> = (system: string, prompt: string) => Promise<{ data: T; usage: ClaudeUsage }>;

export const REWRITE_SYSTEM = `Turn a person's question about their own life into up to 3 short keyword searches over their journals, notes, calendar and saved links. Use the words they would actually have written (synonyms, concrete nouns), not the question's phrasing.
Reply with JSON only: {"queries":["...","..."]}`;

export const ANSWER_SYSTEM = `You answer a person's search over their own journal, notes, records and saved links, using ONLY the numbered sources.
Write "what we found" in 2-5 short plain sentences, second person ("you"). Every sentence that says something about them ends with the source numbers it rests on, like [2] or [1][4].
Don't guess beyond the sources; no feelings or motives unless a source states them. Answer with whatever the sources do say, even if partial; if things changed over time (started then stopped, planned then dropped), say both, in order, with dates when the sources give them. Abstain only when no source bears on the question at all.
Sources marked "automated" (newsletters, app summaries) or "someone else" are things that arrived, not evidence about the person: never rest a sentence about their state, feelings or habits on them; you may only say that such a message arrived.
If the question asks for a judgement about their inner state, motives or future (are you burned out, why do you, will you quit, is a relationship strained) and no source in their own words states it, abstain, with a "why" that names what the sources do show.
First note every source that bears on the question as a dated fact, oldest first; count and order from those notes, not from memory (for "how many" or "which came first", the notes are the answer).
Reply with JSON only: {"notes": ["2026-08-04 [3] signed up for ...", "..."], "abstain": false, "sentences": ["...[1]", "..."]} or {"notes": [...], "abstain": true, "why": "<one plain sentence>"}`;

const CITE = /\[(\d+)\]/g;

/** The source numbers a sentence cites, and the sentence without them. Pure. */
export function citations(sentence: string): { text: string; cites: number[] } {
  const cites = [...sentence.matchAll(CITE)].map((m) => Number(m[1]));
  return { text: sentence.replace(CITE, '').replace(/\s+([.,;!?])/g, '$1').trim(), cites: [...new Set(cites)] };
}

/** Merge hits from several searches: one per item, best score kept. Pure. */
export function mergeHits(lists: SearchHit[][], limit = 15): SearchHit[] {
  const best = new Map<string, SearchHit>();
  for (const list of lists) for (const h of list) {
    const k = `${h.kind}:${h.id}`;
    if (!best.has(k) || best.get(k)!.score < h.score) best.set(k, h);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

// How each item's trust class is shown to the writer and the guard; own words and records need no label.
const TRUST_LABEL: Record<string, string> = { automated: ', automated', third_party: ', someone else', reference: ', saved link' };

async function trustOfItems(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunks(ids)) {
    const { data, error } = await supabase.from('raw_content').select('id, trust_class').in('id', part);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ id: string; trust_class: string | null }>) if (r.trust_class) out.set(r.id, r.trust_class);
  }
  return out;
}

export async function searchAndAnswer(userId: string, query: string, options: {
  search?: (q: string, embed: boolean) => Promise<SearchHit[]>;
  rewrite?: Json<{ queries?: unknown }>; write?: Json<{ abstain?: unknown; sentences?: unknown; why?: unknown }>;
  guard?: GuardModel; asOf?: string; trustOf?: (itemIds: string[]) => Promise<Map<string, string>>;
} = {}): Promise<SearchResult> {
  const zero = { inputTokens: 0, outputTokens: 0 };
  const search = options.search ?? ((q, embed) => searchPerson(userId, q, { limit: 15, embed: embed ? undefined : async () => null }));
  const rewrite = options.rewrite ?? ((s, p) => claudeJsonCompletion(s, p, { model: config.anthropic.timeCategoryModel, maxTokens: 200 }));
  const write = options.write ?? ((s, p) => claudeJsonCompletion(s, p, { model: config.anthropic.writerModel, maxTokens: 3000 }));

  // A failed rewrite just means fewer searches, never a failed search.
  const rw = await rewrite(REWRITE_SYSTEM, query).catch(() => ({ data: {} as { queries?: unknown }, usage: zero }));
  const extra = Array.isArray(rw.data.queries) ? rw.data.queries.map(String).filter(Boolean).slice(0, 3) : [];
  const hits = mergeHits(await Promise.all([search(query, true), ...extra.map((q) => search(q, false))]));
  const sources = hits.map((h, i) => ({ n: i + 1, kind: h.kind, id: h.id, date: h.happened_at ? String(h.happened_at).slice(0, 10) : null, snippet: h.snippet }));
  const trust = await (options.trustOf ?? trustOfItems)(sources.filter((x) => x.kind === 'item').map((x) => x.id)).catch((err) => { console.warn(`[search] trust labels unavailable: ${(err as Error).message}`); return new Map<string, string>(); });
  const empty = (why: string, w = zero): SearchResult => ({ query, summary: why, abstained: true, sources, cut: [], usage: { rewrite: rw.usage, write: w, guard: zero } });
  if (!sources.length) return empty('Nothing in your bank speaks to this yet.');

  // The guard must see each source exactly as the writer did, date included, or every "when" gets cut.
  const shown = new Map(sources.map((s) => [s.n, `(${s.kind}${TRUST_LABEL[trust.get(s.id) ?? ''] ?? ''}${s.date ? `, ${s.date}` : ''}) ${s.snippet}`]));
  // Oldest first, so a change over time reads as a timeline; numbers stay as ranked. Undated last.
  const inTime = [...sources].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  const prompt = `QUESTION: ${query}\n\nSOURCES (oldest first)\n${inTime.map((s) => `[${s.n}] ${shown.get(s.n)}`).join('\n')}`;
  // One retry if the reply comes back malformed (seen in the S1.3 gate run).
  const ans = await write(ANSWER_SYSTEM, prompt).catch(() => write(ANSWER_SYSTEM, prompt)).catch(() => null);
  if (!ans) return empty('The answer could not be written this time; the sources are below.');
  if (ans.data.abstain === true || !Array.isArray(ans.data.sentences)) return empty(typeof ans.data.why === 'string' ? ans.data.why : 'Nothing in your bank really answers this.', ans.usage);

  const lines = (ans.data.sentences as unknown[]).map(String).map(citations);
  const { results, usage: guardUsage } = await guardSentences(lines.map((l) => ({ text: l.text, evidence: l.cites.map((n) => shown.get(n)).filter(Boolean) as string[] })), options.guard, options.asOf ?? new Date().toISOString().slice(0, 10));
  const keptIdx = lines.map((_, i) => i).filter((i) => results[i]!.verdict === 'supported');
  const summary = keptIdx.map((i) => (ans.data.sentences as unknown[])[i]).map(String).join(' ');
  return {
    query, summary: summary || 'Nothing in your bank really answers this.', abstained: !summary, sources,
    cut: lines.flatMap((l, i) => (results[i]!.verdict === 'supported' ? [] : [{ sentence: l.text, reason: results[i]!.reason }])),
    usage: { rewrite: rw.usage, write: ans.usage, guard: guardUsage },
  };
}
