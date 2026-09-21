import { encode } from 'gpt-tokenizer';

/**
 * Measuring what we are about to send, instead of guessing at it.
 *
 * The batcher used to budget in characters against a limit expressed in tokens,
 * converting between them with a fixed ratio. That ratio is not fixed: dense
 * prose, JSON connector payloads and voice transcripts tokenize very
 * differently, so the estimate could be out by a wide margin in either
 * direction -- and when it was out in the wrong direction the request was
 * rejected outright and the entries were written off.
 *
 * Counting locally costs microseconds and no money. There is no good reason to
 * guess.
 */

/**
 * Read a positive integer from the environment, or fall back.
 *
 * Number() alone is not safe here. `OPENAI_TPM_LIMIT=30k` yields NaN, and NaN
 * does not throw -- it spreads. Every comparison against it is false, so the
 * batch-size guard silently stops firing and one enormous request goes out:
 * the original bug, reintroduced by a typo in an env var, with no error to
 * explain it. A bad value falls back loudly instead.
 */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[token-budget] ${name}="${raw}" is not a positive number; using ${fallback}`);
    return fallback;
  }
  return Math.floor(n);
}

/**
 * Tokens per minute the account may spend. OpenAI Tier 1 is 30,000 for gpt-4o.
 * Configurable because the ceiling moves with the account tier, and hard-coding
 * it is how the previous constant drifted out of date.
 */
export const TPM_LIMIT = envInt('OPENAI_TPM_LIMIT', 30_000);

/**
 * Held back from the budget for the model's reply. Must be at least the
 * max_tokens the call asks for, or the request is over the limit before the
 * model writes a word.
 */
export const OUTPUT_RESERVE = envInt('OPENAI_OUTPUT_RESERVE', 4_096);

/**
 * Left over after overhead and output. Not spent down to the last token: the
 * limit is a per-MINUTE rate across every concurrent call, so a batch that fits
 * exactly can still be refused when something else is in flight.
 */
export const SAFETY_MARGIN = 0.85;

export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

/**
 * What is left for content once the fixed prompt and the reply are paid for.
 * `overheadTokens` should be measured from the real assembled prompt, not
 * assumed -- that assumption is the other half of how this went wrong.
 */
export function contentTokenBudget(overheadTokens: number): number {
  const usable = (TPM_LIMIT - OUTPUT_RESERVE - overheadTokens) * SAFETY_MARGIN;
  // Never return a budget so small that no entry could ever be sent; the caller
  // sends an oversized entry alone and lets the split-on-refusal path handle it.
  return Math.max(Math.floor(usable), 1_000);
}
