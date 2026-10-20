/**
 * Goal 21: propose hypotheses. A model suggests; code decides (validate.ts).
 * Each proposal names a framework from the closed catalogue and the claims it
 * rests on; "sources" counts the distinct source rows under those claims, so
 * two claims from one journal entry are one source.
 */

import { supabase } from '../db/supabase';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { walkEvidence, type ClaimKind } from '../brain/lineage';
import type { UnderstandingContract } from '../understanding/read';
import { FRAMEWORKS, invalid, type FrameworkId } from './validate';

export interface EvidenceLine { n: number; kind: ClaimKind; id: string; text: string; domainId: string | null }
type Raw = { hypotheses?: Array<{ framework?: unknown; domain?: unknown; question?: unknown; rationale?: unknown; supports?: unknown }> };
type Model = (system: string, prompt: string) => Promise<{ data: Raw; usage: ClaudeUsage }>;

export const PROPOSE_SYSTEM = `You help a personal reflection product wonder about one person, carefully.
From the numbered things it knows about them, propose at most 3 hypotheses: things their own words don't directly say, that might help them see themselves.
Each must use one framework from this list, by id, and rest on at least two of the numbered items:
${Object.entries(FRAMEWORKS).map(([id, f]) => `- ${id}: ${f.name}; wonders ${f.wonders}`).join('\n')}
Rules: phrase each as a short, warm, specific question to them ("Is it...?", "Could it be...?"). Never clinical: no diagnoses, disorders, conditions, trauma or therapy language, not even hedged. No flattery. If nothing is worth wondering, return none.
Reply with JSON only: {"hypotheses":[{"framework":"<id>","domain":"<domain id or null>","question":"...?","rationale":"one sentence on why, citing the items","supports":[<item numbers>]}]}`;

/** The numbered things a hypothesis may rest on: stated answers, live patterns, goals. Pure. */
export function evidenceLines(c: UnderstandingContract): EvidenceLine[] {
  const lines: Array<Omit<EvidenceLine, 'n'>> = [
    ...c.answers.filter((a) => a.register === 'stated').map((a) => ({ kind: 'answer' as const, id: a.id, text: `${a.question} ${a.answer}`, domainId: a.domainId })),
    ...c.patterns.map((p) => ({ kind: 'pattern' as const, id: p.id, text: `${p.label} (${p.instances} times)`, domainId: null })),
  ];
  return lines.map((l, i) => ({ ...l, n: i + 1 }));
}

export interface Proposed { framework: FrameworkId; domainId: string | null; question: string; rationale: string; supports: Array<{ kind: ClaimKind; id: string }>; sources: number }

export async function proposeHypotheses(c: UnderstandingContract, options: { model?: Model; sourcesOf?: (claims: Array<{ kind: ClaimKind; id: string }>) => Promise<number>; declined?: string[] } = {}): Promise<{ valid: Proposed[]; rejected: Array<{ question: string; why: string }>; usage: ClaudeUsage }> {
  const model = options.model ?? ((s, p) => claudeJsonCompletion<Raw>(s, p, { model: config.anthropic.writerModel, maxTokens: 900 }));
  const sourcesOf = options.sourcesOf ?? (async (claims) => {
    const ids = new Set<string>();
    for (const cl of claims) for (const s of (await walkEvidence(cl)).sources) ids.add(`${s.kind}:${s.id}`);
    return ids.size;
  });
  const lines = evidenceLines(c);
  const zero = { inputTokens: 0, outputTokens: 0 };
  if (lines.length < 2) return { valid: [], rejected: [], usage: zero };

  const silent = new Set(c.silent.map((s) => s.domainId));
  const declined = (options.declined ?? []).map((q) => `- ${q}`).join('\n');
  const prompt = `WHAT IT KNOWS\n${lines.map((l) => `[${l.n}] ${l.text}${l.domainId ? ` (domain: ${l.domainId})` : ''}`).join('\n')}` +
    (declined ? `\n\nTHEY ALREADY DECLINED THESE; DON'T OFFER THEM AGAIN\n${declined}` : '');
  const reply = await model(PROPOSE_SYSTEM, prompt).catch(() => model(PROPOSE_SYSTEM, prompt)).catch(() => null);
  if (!reply) return { valid: [], rejected: [], usage: zero };

  const valid: Proposed[] = [], rejected: Array<{ question: string; why: string }> = [];
  const byN = new Map(lines.map((l) => [l.n, l]));
  const declinedSet = new Set((options.declined ?? []).map((q) => q.trim().toLowerCase()));
  for (const h of reply.data.hypotheses ?? []) {
    const question = String(h.question ?? '').trim();
    const supports = (Array.isArray(h.supports) ? h.supports : []).map((n) => byN.get(Number(n))).filter(Boolean) as EvidenceLine[];
    const claims = [...new Map(supports.map((s) => [`${s.kind}:${s.id}`, { kind: s.kind, id: s.id }])).values()];
    // The domain must be one the brain may speak in; a pattern-only hypothesis takes the domain of an answer it rests on.
    const domainId = typeof h.domain === 'string' && h.domain ? h.domain : supports.find((s) => s.domainId)?.domainId ?? null;
    const domainMaySpeak = domainId !== null && !silent.has(domainId) && c.answers.some((a) => a.domainId === domainId);
    const why = declinedSet.has(question.toLowerCase()) ? 'already declined'
      : invalid({ framework: String(h.framework ?? ''), question, supports: claims.length, sources: claims.length >= 2 ? await sourcesOf(claims) : 0, domainMaySpeak });
    if (why) { rejected.push({ question, why }); continue; }
    valid.push({ framework: h.framework as FrameworkId, domainId, question, rationale: String(h.rationale ?? ''), supports: claims, sources: await sourcesOf(claims) });
  }
  return { valid, rejected, usage: reply.usage };
}

/** Keep valid proposals, skipping ones already held or declined. Returns how many are new. */
export async function storeHypotheses(userId: string, proposed: Proposed[], db: typeof supabase = supabase): Promise<number> {
  const { data } = await db.from('hypotheses').select('question').eq('user_id', userId).limit(500);
  const have = new Set(((data ?? []) as Array<{ question: string }>).map((r) => r.question.trim().toLowerCase()));
  let added = 0;
  for (const p of proposed) {
    if (have.has(p.question.toLowerCase())) continue;
    const { error } = await db.from('hypotheses').insert({ user_id: userId, framework: p.framework, domain_id: p.domainId, question: p.question, rationale: p.rationale, supports: p.supports, model_version: config.anthropic.writerModel });
    if (error) throw new Error(`storeHypotheses: ${error.message}`);
    added++;
  }
  return added;
}
