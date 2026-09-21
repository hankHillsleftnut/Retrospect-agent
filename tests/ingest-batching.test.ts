import { test } from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { contentCharLimit } from '../src/agents/ingestion-agent';
import { classifyRateLimit, RequestTooLargeError } from '../src/services/openai';
import { countTokens, contentTokenBudget, TPM_LIMIT, OUTPUT_RESERVE } from '../src/services/token-budget';
import { estimateEntryTokens, batchRawContent, splitBatch } from '../src/pipelines/ingest';
import type { DbRawContent } from '../src/types';

// The failure this file exists to prevent:
//
// The batcher budgeted in characters against a limit expressed in tokens, using
// a fixed ratio, and measured every entry at 4,000 characters while the agent
// sent up to 20,000. Batches went out several times larger than believed, were
// refused, and the refusal -- a 429 -- was treated as "you are going too fast".
// The identical oversized request was resent, refused again, and the entries
// were written off as permanently failed.
//
// Two things are pinned here: the measurement is real, and a refusal that means
// "too big" is answered by splitting rather than by waiting.

const entry = (contentType: string, chars: number): DbRawContent =>
  ({
    id: `id-${contentType}-${chars}`,
    user_id: 'u',
    content_type: contentType,
    content: 'lorem ipsum dolor sit amet '.repeat(Math.ceil(chars / 27)).slice(0, chars),
    content_date: null,
    created_at: new Date().toISOString(),
    processing_status: 'pending',
    metadata: {},
  }) as unknown as DbRawContent;

// --------------------------------------------------------------- measurement

test('tokens are counted, not inferred from a character ratio', () => {
  // Prose and repeated punctuation tokenize very differently at equal length --
  // which is precisely why a fixed chars-per-token ratio could not be trusted.
  const prose = countTokens('the quick brown fox jumps over the lazy dog');
  const punct = countTokens('!@#$%^&*()!@#$%^&*()!@#$%^&*()!@#$%^&*()!!!');
  assert.ok(prose > 0 && punct > 0);
  assert.notEqual(prose, punct, 'equal-length strings should not measure equal');
});

test('an entry is measured on the body that is actually sent, not the whole row', () => {
  const cap = contentCharLimit('journal_entry');
  const huge = entry('journal_entry', cap * 4);
  const atCap = entry('journal_entry', cap);
  assert.equal(
    estimateEntryTokens(huge),
    estimateEntryTokens(atCap),
    'content beyond the per-entry cap is truncated before sending and must not be counted',
  );
});

test('the content budget leaves room for overhead and the reply', () => {
  const overhead = 8_000;
  const budget = contentTokenBudget(overhead);
  assert.ok(
    budget + overhead + OUTPUT_RESERVE <= TPM_LIMIT,
    `budget ${budget} + overhead ${overhead} + reserve ${OUTPUT_RESERVE} exceeds ${TPM_LIMIT}`,
  );
});

test('a budget is still returned when overhead is absurdly large', () => {
  // Never return zero or negative: the caller sends one entry alone and lets
  // the split-on-refusal path deal with it.
  assert.ok(contentTokenBudget(TPM_LIMIT * 2) > 0);
});

// ------------------------------------------------------------------ batching

test('no batch exceeds the token budget, except a lone oversized entry', () => {
  const budget = 5_000;
  const entries = Array.from({ length: 30 }, () => entry('journal_entry', 8_000));
  for (const batch of batchRawContent(entries, budget)) {
    if (batch.length === 1) continue; // sent whole, by design
    const total = batch.reduce((n, e) => n + estimateEntryTokens(e), 0);
    assert.ok(total <= budget, `batch of ${batch.length} totals ${total}, over ${budget}`);
  }
});

test('every entry ends up in exactly one batch', () => {
  const entries = Array.from({ length: 17 }, (_, i) => entry('text_entry', 500 + i));
  const batched = batchRawContent(entries, 2_000).flat();
  assert.equal(batched.length, entries.length);
  assert.deepEqual(new Set(batched.map((e) => e.id)).size, entries.length);
});

// ------------------------------------------------------------------ the 429

const apiError = (message: string, status = 429) =>
  new OpenAI.APIError(status, { message }, message, {});

test('"request too large" is classified as too_big, not too_fast', () => {
  const err = apiError(
    'Request too large for gpt-4o on tokens per min (TPM): Limit 30000, Requested 34954.',
  );
  assert.equal(classifyRateLimit(err), 'too_big');
});

test('an ordinary rate limit is still classified as too_fast', () => {
  const err = apiError('Rate limit reached for gpt-4o. Please try again in 1.2s.');
  assert.equal(classifyRateLimit(err), 'too_fast');
});

test('non-429 errors are not classified as rate limits at all', () => {
  assert.equal(classifyRateLimit(apiError('Internal server error', 500)), null);
  assert.equal(classifyRateLimit(new Error('socket hang up')), null);
});

test('RequestTooLargeError carries the figures when OpenAI reports them', () => {
  const e = new RequestTooLargeError('too large', 34954, 30000);
  assert.equal(e.requested, 34954);
  assert.equal(e.limit, 30000);
  assert.ok(e instanceof Error);
});

// ------------------------------------------------------------------ splitting

test('splitting halves a batch and loses nothing', () => {
  const batch = [1, 2, 3, 4, 5, 6, 7];
  const [a, b] = splitBatch(batch);
  assert.deepEqual([...a, ...b], batch);
  assert.ok(a.length > 0 && b.length > 0, 'neither half may be empty, or the loop cannot terminate');
});

test('splitting a pair yields two batches of one, so it always terminates', () => {
  const [a, b] = splitBatch(['x', 'y']);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
});
