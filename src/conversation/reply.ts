/**
 * Talking to it bit by bit (goal 18). Today's turns are working memory; the
 * brain is the long-term memory. Every sentence it says passes the same fact
 * check and style check as an episode, plus goal 18's own rules: a bounded
 * length, no restating your words as discovery, and nothing revealed outside
 * its context. Saying nothing is a valid reply. See approach-calibration.md, goal 18.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { usageLines } from '../pipelines/spend-ledger';
import type { CostLine } from '../pipelines/trace';
import { searchPerson, type SearchHit } from '../search/search';
import { readUnderstanding, type UnderstandingContract } from '../understanding/read';
import { guardSentences, type GuardModel } from '../writer/claim-guard';
import { styleIssue } from '../writer/style';
import { handleCorrection } from '../corrections/target';
import { mayReveal, restatesAsDiscovery, sentenceBudget } from './rules';

export const WORKING_MEMORY_HOURS = 18;

export const CONVERSE_SYSTEM = `You are a calm, specific companion the person talks to during their day. You know them only through the numbered CONTEXT.
First decide what they're doing:
- "fyi": they're just telling you or sending something. Then say nothing (empty sentences) or one word of acknowledgement.
- "question": answer it in your first sentence, directly.
- "correction": they're saying something you believe about them is wrong.
- "chat": anything else.
Rules: at most BUDGET sentences, short, spoken. Never repeat what they just told you as if you'd noticed it. Never therapeutic-generic, never flattery. Every sentence that says something about them cites the context numbers it rests on, like [2]. Don't bring up anything they didn't ask about unless it truly helps right now.
Reply with JSON only: {"intent":"fyi|question|correction|chat","sentences":["... [1]"]}`;

type Turn = { role: 'person' | 'companion'; text: string; created_at: string };
type Raw = { intent?: unknown; sentences?: unknown };
type Model = (system: string, prompt: string) => Promise<{ data: Raw; usage: ClaudeUsage }>;
export interface ContextLine { n: number; kind: string; id: string; text: string }
export interface ConverseResult { intent: 'fyi' | 'question' | 'correction' | 'chat'; reply: string; cut: Array<{ sentence: string; reason: string }>; used: Array<{ kind: string; id: string }>; usage: ClaudeUsage; /** Priced by model (writer, guard), for the spend ledger (BEA.4). */ cost: CostLine[] }

const asks = (t: string) => /\?\s*$/.test(t.trim()) || /^(what|when|where|why|how|who|which|did|do|does|is|are|was|were|can|could|should|have|has)\b/i.test(t.trim());
const CITE = /\[(\d+)\]/g;

/** Pure: the numbered context the reply may draw on, after the context rules. */
export function buildContext(c: UnderstandingContract, hits: Array<SearchHit & { trust?: string | null }>, theyAsked: boolean): ContextLine[] {
  const silent = new Set(c.silent.map((s) => s.domainId));
  const lines: Array<Omit<ContextLine, 'n'>> = [];
  for (const a of c.answers) if (mayReveal({ kind: 'answer', id: a.id, silentDomain: silent.has(a.domainId) }, theyAsked)) lines.push({ kind: 'answer', id: a.id, text: `${a.register === 'asked' ? '(a guess, ask don\'t state) ' : ''}${a.question} ${a.answer}` });
  for (const p of c.patterns) lines.push({ kind: 'pattern', id: p.id, text: `${p.label} (${p.instances} times)` });
  for (const h of hits) {
    if (h.kind === 'answer' && lines.some((l) => l.id === h.id)) continue;
    if (!mayReveal({ kind: h.kind, id: h.id, trust: h.trust ?? null }, theyAsked)) continue;
    lines.push({ kind: h.kind, id: h.id, text: `${h.happened_at ? `(${String(h.happened_at).slice(0, 10)}) ` : ''}${h.snippet}` });
  }
  return lines.slice(0, 40).map((l, i) => ({ ...l, n: i + 1 }));
}

export async function converse(userId: string, text: string, options: { now?: Date; model?: Model; guard?: GuardModel; db?: typeof supabase; contract?: UnderstandingContract; search?: typeof searchPerson; correct?: typeof handleCorrection } = {}): Promise<ConverseResult> {
  const db = options.db ?? supabase;
  const now = options.now ?? new Date();
  const model = options.model ?? ((s, p) => claudeJsonCompletion<Raw>(s, p, { model: config.anthropic.writerModel, maxTokens: 500 }));
  const zero = { inputTokens: 0, outputTokens: 0 };

  // Their words are theirs: saved like anything they send, so the brain reads them.
  const { data: raw } = await db.from(Tables.RAW_CONTENT).insert({ user_id: userId, content_type: 'conversation', content: text, authorship: 'self', trust_class: 'own_words' }).select('id').single();
  await db.from('conversation_turns').insert({ user_id: userId, role: 'person', text, raw_content_id: (raw as { id: string } | null)?.id ?? null, created_at: now.toISOString() });

  const since = new Date(now.getTime() - WORKING_MEMORY_HOURS * 3600e3).toISOString();
  const { data: turnRows } = await db.from('conversation_turns').select('role,text,created_at').eq('user_id', userId).gte('created_at', since).order('created_at').order('id').limit(60);
  const turns = (turnRows ?? []) as Turn[];
  const theyAsked = asks(text);
  const contract = options.contract ?? await readUnderstanding(userId, db);
  // Their message was just saved; it is not context about itself.
  const thisRaw = (raw as { id: string } | null)?.id;
  const hits = (await (options.search ?? searchPerson)(userId, text, { limit: 12 }).catch(() => [] as SearchHit[])).filter((h) => h.id !== thisRaw);
  // What they said earlier today is their own words, so it can be cited like anything else.
  const ctx = [...buildContext(contract, hits, theyAsked)];
  for (const t of turns) if (t.role === 'person' && t.text !== text) ctx.push({ n: ctx.length + 1, kind: 'said_today', id: t.created_at, text: `(they said today) ${t.text}` });
  const budget = sentenceBudget(text);

  // The new message is named on its own: turn order in the history can tie, and replying to the wrong one is the worst kind of forgetting.
  const earlier = turns.filter((t, i) => !(t.role === 'person' && t.text === text && i === turns.map((x) => x.text).lastIndexOf(text)));
  const prompt = `BUDGET: ${budget} sentence(s)\n\nEARLIER TODAY\n${earlier.map((t) => `${t.role === 'person' ? 'THEM' : 'YOU'}: ${t.text}`).join('\n') || '(nothing yet)'}\n\nCONTEXT\n${ctx.map((l) => `[${l.n}] ${l.text}`).join('\n') || '(nothing relevant)'}\n\nTHEIR NEW MESSAGE, THE ONE TO REPLY TO\n${text}`;
  const out = await model(CONVERSE_SYSTEM, prompt).catch(() => model(CONVERSE_SYSTEM, prompt)).catch((err) => { console.warn(`[conversation] reply failed twice: ${(err as Error).message.slice(0, 200)}`); return null; });
  if (!out) return save({ intent: 'chat', reply: '', cut: [], used: [] }, zero, zero);
  const intent = (['fyi', 'question', 'correction', 'chat'].includes(String(out.data.intent)) ? out.data.intent : 'chat') as ConverseResult['intent'];

  if (intent === 'correction') {
    const r = await (options.correct ?? handleCorrection)(userId, text);
    const reply = r.outcome === 'applied' ? r.echo
      : r.outcome === 'ask_own_words' ? `You wrote "${r.quote}"${r.writtenOn ? ` on ${r.writtenOn}` : ''}. Has that changed, or did I read it wrong?`
      : r.outcome === 'confirm' && r.candidates.length ? `Which did you mean: ${r.candidates.map((c) => `"${c.text}"`).join(', or ')}?` : 'Got it.';
    // The correction's own model call is this turn's spending too.
    return save({ intent, reply, cut: [], used: [] }, { inputTokens: out.usage.inputTokens + r.usage.inputTokens, outputTokens: out.usage.outputTokens + r.usage.outputTokens }, zero);
  }

  const sentences = (Array.isArray(out.data.sentences) ? out.data.sentences : []).map(String).filter((s) => s.trim()).slice(0, 6);
  if (!sentences.length) return save({ intent, reply: '', cut: [], used: [] }, out.usage, zero);
  const byN = new Map(ctx.map((l) => [l.n, l]));
  const parsed = sentences.map((s) => ({ s, cites: [...s.matchAll(CITE)].map((m) => Number(m[1])), text: s.replace(CITE, '').replace(/\s+([.,;!?])/g, '$1').trim() }));
  const { results, usage: gu } = await guardSentences(parsed.map((p) => ({ text: p.text, evidence: p.cites.map((n) => byN.get(n)?.text).filter(Boolean) as string[] })), options.guard, now.toISOString().slice(0, 10));
  const theirWords = turns.filter((t) => t.role === 'person').map((t) => t.text);
  const kept: string[] = [], cut: ConverseResult['cut'] = [], used = new Map<string, { kind: string; id: string }>();
  parsed.forEach((p, i) => {
    const why = results[i]!.verdict !== 'supported' ? results[i]!.reason : styleIssue(p.text) ?? (restatesAsDiscovery(p.text, theirWords) ? 'restates their own words as a discovery (goal 18)' : null);
    if (why) { cut.push({ sentence: p.text, reason: why }); return; }
    // The budget counts what survives the checks, so a cut sentence never crowds out a good one.
    if (kept.length >= budget) { cut.push({ sentence: p.text, reason: `over the ${budget}-sentence budget (goal 18)` }); return; }
    kept.push(p.text);
    for (const n of p.cites) { const l = byN.get(n); if (l) used.set(`${l.kind}:${l.id}`, { kind: l.kind, id: l.id }); }
  });
  return save({ intent, reply: kept.join(' '), cut, used: [...used.values()] }, out.usage, gu);

  async function save(partial: Omit<ConverseResult, 'usage' | 'cost'>, writer: ClaudeUsage, guard: ClaudeUsage): Promise<ConverseResult> {
    const r: ConverseResult = {
      ...partial,
      usage: { inputTokens: writer.inputTokens + guard.inputTokens, outputTokens: writer.outputTokens + guard.outputTokens },
      cost: usageLines([{ model: config.anthropic.writerModel, usage: writer }, { model: config.anthropic.guardModel, usage: guard }]),
    };
    // Its own words are kept for working memory only, never read as facts about the person.
    if (r.reply) await db.from('conversation_turns').insert({ user_id: userId, role: 'companion', text: r.reply, used: r.used, created_at: new Date(now.getTime() + 1).toISOString() });
    return r;
  }
}
