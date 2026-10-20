/**
 * The claim guard (W6.1, goal 14): nothing said about the person that the
 * evidence doesn't support, and nothing hedged that lands as certain.
 *
 * Calibrated 20 Oct (approach-calibration.md): extract only VERIFIABLE claims
 * about the person (VeriScore: subjective and figurative language is not
 * checked, so craft is never sanded down), then check each against the
 * sentence's evidence (MiniCheck-style grounding check, small model). The
 * decision rules live here, in code:
 *   no verifiable claims          craft: passes
 *   stated sentence               every claim supported, else unsupported
 *   asked sentence                must read as a question, and the facts it
 *                                 takes for granted must be supported
 */

import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';

export interface GuardSentence { text: string; register?: 'stated' | 'asked'; evidence: string[] }
export interface ClaimJudgement { claim: string; supported: boolean }
export interface SentenceJudgement { claims: ClaimJudgement[]; isQuestion: boolean }
export interface GuardResult { verdict: 'supported' | 'unsupported'; reason: string; claims: ClaimJudgement[] }

export const GUARD_SYSTEM = `You check sentences from a personal audio episode against the evidence given for each.
For each sentence:
1. List only the VERIFIABLE claims it makes about the person (things they did, said, have, or how often). Ignore figurative language, opinions about the world, and the speaker's own musing.
   A claim about the person's feelings, motives or relationships counts as a claim too.
   If the sentence is a question or a musing ("I wonder whether..."), list only what it takes for granted as true.
2. For each claim: supported = true only if the evidence states it or plainly entails it. Counting and recency must match. A guess by an automated sender about the person is not evidence.
3. isQuestion = true if the sentence is phrased as a question or an explicit wondering.
Reply with JSON only: {"sentences":[{"i":<n>,"claims":[{"claim":"...","supported":true|false}],"isQuestion":true|false}]}`;

export function guardPrompt(sentences: GuardSentence[], asOf?: string): string {
  return (asOf ? `Today is ${asOf}. "This week" and "this month" mean relative to today.\n\n` : '') + sentences.map((s, i) => `SENTENCE ${i}: ${s.text}\nEVIDENCE ${i}:\n${s.evidence.map((e) => `- ${e}`).join('\n') || '- (none)'}`).join('\n\n');
}

/** The decision, from the model's judgements. Pure. */
export function decide(s: GuardSentence, j: SentenceJudgement | undefined): GuardResult {
  if (!j) return { verdict: 'unsupported', reason: 'not checked', claims: [] };
  const unsupported = j.claims.filter((c) => !c.supported);
  if ((s.register ?? 'stated') === 'asked') {
    if (!j.isQuestion) return { verdict: 'unsupported', reason: 'meant to be asked, but reads as a statement', claims: j.claims };
    if (unsupported.length) return { verdict: 'unsupported', reason: `takes for granted: ${unsupported.map((c) => c.claim).join('; ')}`, claims: j.claims };
    return { verdict: 'supported', reason: 'asked, on supported ground', claims: j.claims };
  }
  if (j.claims.length === 0) return { verdict: 'supported', reason: 'no claims about the person (craft)', claims: [] };
  if (unsupported.length) return { verdict: 'unsupported', reason: `not in the evidence: ${unsupported.map((c) => c.claim).join('; ')}`, claims: j.claims };
  return { verdict: 'supported', reason: 'every claim supported', claims: j.claims };
}

export type GuardModel = (system: string, prompt: string) => Promise<{ data: { sentences?: Array<{ i?: unknown; claims?: unknown; isQuestion?: unknown }> }; usage: ClaudeUsage }>;

const defaultModel: GuardModel = (s, p) => claudeJsonCompletion(s, p, { model: config.anthropic.guardModel, maxTokens: 4000 });

export async function guardSentences(sentences: GuardSentence[], model: GuardModel = defaultModel, asOf?: string): Promise<{ results: GuardResult[]; usage: ClaudeUsage }> {
  // Relative time ("this month") can only be checked against a date (found by gate W6, case g7).
  const { data, usage } = await model(GUARD_SYSTEM, guardPrompt(sentences, asOf));
  const byIndex = new Map<number, SentenceJudgement>();
  for (const r of data.sentences ?? []) {
    const i = Number(r.i);
    if (!Number.isInteger(i)) continue;
    const claims = Array.isArray(r.claims) ? (r.claims as Array<{ claim?: unknown; supported?: unknown }>).map((c) => ({ claim: String(c.claim ?? ''), supported: c.supported === true })) : [];
    byIndex.set(i, { claims, isQuestion: r.isQuestion === true });
  }
  return { results: sentences.map((s, i) => decide(s, byIndex.get(i))), usage };
}
