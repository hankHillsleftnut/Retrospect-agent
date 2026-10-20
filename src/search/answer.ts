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
Don't guess beyond the sources; no feelings or motives unless a source states them. If the sources don't really answer the question, abstain.
Reply with JSON only: {"abstain": false, "sentences": ["...[1]", "..."]} or {"abstain": true, "why": "<one plain sentence>"}`;

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

export async function searchAndAnswer(userId: string, query: string, options: {
  search?: (q: string, embed: boolean) => Promise<SearchHit[]>;
  rewrite?: Json<{ queries?: unknown }>; write?: Json<{ abstain?: unknown; sentences?: unknown; why?: unknown }>;
  guard?: GuardModel; asOf?: string;
} = {}): Promise<SearchResult> {
  const zero = { inputTokens: 0, outputTokens: 0 };
  const search = options.search ?? ((q, embed) => searchPerson(userId, q, { limit: 15, embed: embed ? undefined : async () => null }));
  const rewrite = options.rewrite ?? ((s, p) => claudeJsonCompletion(s, p, { model: config.anthropic.timeCategoryModel, maxTokens: 200 }));
  const write = options.write ?? ((s, p) => claudeJsonCompletion(s, p, { model: config.anthropic.writerModel, maxTokens: 800 }));

  const rw = await rewrite(REWRITE_SYSTEM, query);
  const extra = Array.isArray(rw.data.queries) ? rw.data.queries.map(String).filter(Boolean).slice(0, 3) : [];
  const hits = mergeHits(await Promise.all([search(query, true), ...extra.map((q) => search(q, false))]));
  const sources = hits.map((h, i) => ({ n: i + 1, kind: h.kind, id: h.id, date: h.happened_at ? String(h.happened_at).slice(0, 10) : null, snippet: h.snippet }));
  const empty = (why: string, w = zero): SearchResult => ({ query, summary: why, abstained: true, sources, cut: [], usage: { rewrite: rw.usage, write: w, guard: zero } });
  if (!sources.length) return empty('Nothing in your bank speaks to this yet.');

  const prompt = `QUESTION: ${query}\n\nSOURCES\n${sources.map((s) => `[${s.n}] (${s.kind}${s.date ? `, ${s.date}` : ''}) ${s.snippet}`).join('\n')}`;
  const ans = await write(ANSWER_SYSTEM, prompt);
  if (ans.data.abstain === true || !Array.isArray(ans.data.sentences)) return empty(typeof ans.data.why === 'string' ? ans.data.why : 'Nothing in your bank really answers this.', ans.usage);

  const lines = (ans.data.sentences as unknown[]).map(String).map(citations);
  const byN = new Map(sources.map((s) => [s.n, s.snippet]));
  const { results, usage: guardUsage } = await guardSentences(lines.map((l) => ({ text: l.text, evidence: l.cites.map((n) => byN.get(n)).filter(Boolean) as string[] })), options.guard, options.asOf ?? new Date().toISOString().slice(0, 10));
  const keptIdx = lines.map((_, i) => i).filter((i) => results[i]!.verdict === 'supported');
  const summary = keptIdx.map((i) => (ans.data.sentences as unknown[])[i]).map(String).join(' ');
  return {
    query, summary: summary || 'Nothing in your bank really answers this.', abstained: !summary, sources,
    cut: lines.flatMap((l, i) => (results[i]!.verdict === 'supported' ? [] : [{ sentence: l.text, reason: results[i]!.reason }])),
    usage: { rewrite: rw.usage, write: ans.usage, guard: guardUsage },
  };
}
