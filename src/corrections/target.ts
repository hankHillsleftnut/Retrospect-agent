/**
 * "That's wrong", in plain words (goal 20, F-C3). Search finds what the brain
 * believes that the words could be about; a model only *proposes* which one is
 * meant; applying is deterministic (apply.ts). Anything unsure is confirmed
 * with the person, never guessed. See approach-calibration.md, goal 20.
 */

import { supabase } from '../db/supabase';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { searchPerson } from '../search/search';
import type { ClaimKind } from '../brain/lineage';
import { applyCorrection } from './apply';
import { walkEvidence } from '../brain/lineage';

export interface Candidate { n: number; kind: ClaimKind; id: string; text: string }
type Pick = { correction?: unknown; target?: unknown; sure?: unknown };
type Model = (system: string, prompt: string) => Promise<{ data: Pick; usage: ClaudeUsage }>;

export const TARGET_SYSTEM = `The person is talking about what their personal brain believes about them. Below are things it currently believes, numbered.
Decide whether what they said is a correction: that one of these is wrong, or no longer true. Praise, requests and new information are not corrections.
If it is, pick the one claim their words clearly refer to. If two could fit, or none clearly does, set "sure" to false.
Reply with the JSON object only, no reasoning before or after it: {"correction": true, "target": <number or null>, "sure": true|false}`;

/** What the words could be about: matching facts and answers, plus live patterns. */
export async function correctionCandidates(userId: string, text: string, options: { db?: typeof supabase; search?: typeof searchPerson } = {}): Promise<Candidate[]> {
  const db = options.db ?? supabase;
  const hits = (await (options.search ?? searchPerson)(userId, text, { limit: 20 })).filter((h) => h.kind === 'fact' || h.kind === 'answer');
  const { data } = await db.from('behavior_patterns').select('id,label').eq('user_id', userId).eq('status', 'live').limit(50);
  const patterns = ((data ?? []) as Array<{ id: string; label: string }>).map((p) => ({ kind: 'pattern' as const, id: p.id, text: p.label }));
  return [...hits.map((h) => ({ kind: h.kind as ClaimKind, id: h.id, text: h.snippet })), ...patterns].map((c, i) => ({ ...c, n: i + 1 }));
}

export type CorrectionResult =
  | { outcome: 'not_a_correction'; usage: ClaudeUsage }
  | { outcome: 'applied'; target: Candidate; retired: number; echo: string; usage: ClaudeUsage }
  | { outcome: 'confirm'; candidates: Candidate[]; usage: ClaudeUsage }
  | { outcome: 'ask_own_words'; target: Candidate; quote: string; writtenOn: string | null; usage: ClaudeUsage };

/** If a fact came from the person's own words, the words and when they wrote them. */
export async function ownWordsBehind(userId: string, target: { kind: ClaimKind; id: string }, db: typeof supabase = supabase): Promise<{ quote: string; writtenOn: string | null } | null> {
  if (target.kind !== 'fact') return null;
  const ids = (await walkEvidence(target, db)).sources.filter((s) => s.kind === 'raw_content').map((s) => s.id);
  if (!ids.length) return null;
  const { data } = await db.from('raw_content').select('content,created_at,trust_class').eq('user_id', userId).in('id', ids).eq('trust_class', 'own_words').order('created_at', { ascending: false }).limit(1);
  const r = ((data ?? []) as Array<{ content: string | null; created_at: string | null }>)[0];
  return r ? { quote: (r.content ?? '').slice(0, 200), writtenOn: r.created_at ? String(r.created_at).slice(0, 10) : null } : null;
}

/** Read a possible correction; apply it only when the target is unambiguous. */
export async function handleCorrection(userId: string, text: string, options: { model?: Model; candidates?: Candidate[]; dryRun?: boolean; ownWords?: typeof ownWordsBehind } = {}): Promise<CorrectionResult> {
  const model = options.model ?? ((s, p) => claudeJsonCompletion<Pick>(s, p, { model: config.anthropic.writerModel, maxTokens: 120 }));
  const candidates = options.candidates ?? await correctionCandidates(userId, text);
  const zero = { inputTokens: 0, outputTokens: 0 };
  if (!candidates.length) return { outcome: 'confirm', candidates: [], usage: zero };

  const prompt = `THEY SAID: ${text}\n\nWHAT THE BRAIN BELIEVES\n${candidates.map((c) => `[${c.n}] ${c.text}`).join('\n')}`;
  // A malformed reply is retried once; if it fails again we ask, never guess.
  const reply = await model(TARGET_SYSTEM, prompt).catch(() => model(TARGET_SYSTEM, prompt)).catch(() => null);
  if (!reply) return { outcome: 'confirm', candidates: candidates.slice(0, 3), usage: zero };
  const { data, usage } = reply;
  if (data.correction !== true) return { outcome: 'not_a_correction', usage };
  const target = candidates.find((c) => c.n === Number(data.target));
  if (!target || data.sure !== true) return { outcome: 'confirm', candidates: target ? [target, ...candidates.filter((c) => c !== target)].slice(0, 3) : candidates.slice(0, 3), usage };

  // Something they said themselves is never quietly overwritten: ask whether it changed or was misread (goal 20).
  const own = await (options.ownWords ?? ownWordsBehind)(userId, target);
  if (own) return { outcome: 'ask_own_words', target, quote: own.quote, writtenOn: own.writtenOn, usage };

  const plan = await applyCorrection(userId, { kind: target.kind, id: target.id }, { dryRun: options.dryRun, note: text });
  return { outcome: 'applied', target, retired: plan.retire.length, echo: `Got it. I'll stop saying "${target.text.slice(0, 120)}"${plan.retire.length > 1 ? `, and ${plan.retire.length - 1} thing${plan.retire.length > 2 ? 's' : ''} built on it` : ''}.`, usage };
}
