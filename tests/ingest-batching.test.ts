import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentCharLimit } from '../src/agents/ingestion-agent';
import { MAX_BATCH_CHARS, estimateEntryChars, batchRawContent } from '../src/pipelines/ingest';
import type { DbRawContent } from '../src/types';

// The bug this file exists to prevent:
//
// The batcher measured every entry as at most 4,000 characters while the agent
// sent up to 20,000. It therefore packed batches four times larger than it
// believed, and every full batch exceeded the account's tokens-per-minute
// ceiling -- not intermittently, but always. Entries did not get retried; they
// were written off as permanently failed.
//
// The invariant is simple: the batcher must never think an entry is smaller
// than what actually gets transmitted.

const entry = (contentType: string, chars: number): DbRawContent =>
  ({
    id: `id-${contentType}-${chars}`,
    user_id: 'u',
    content_type: contentType,
    content: 'x'.repeat(chars),
    content_date: null,
    created_at: new Date().toISOString(),
    processing_status: 'pending',
    metadata: {},
  }) as unknown as DbRawContent;

const TYPES = [
  'journal_entry', 'text_entry', 'voice_journal', 'voice_recording',
  'google_docs', 'onboarding_profile', 'healthkit', 'screen_time', 'calendar',
];

test('the batcher never measures an entry as smaller than what is sent', () => {
  for (const type of TYPES) {
    const sent = contentCharLimit(type);
    const measured = estimateEntryChars(entry(type, 1_000_000));
    assert.equal(
      measured,
      sent,
      `${type}: batcher measures ${measured} but the agent sends ${sent}`,
    );
  }
});

test('a short entry is measured at its real length, not the cap', () => {
  assert.equal(estimateEntryChars(entry('journal_entry', 120)), 120);
});

test('a full batch stays inside the character budget', () => {
  // twenty long-form entries at the cap -- far more than one batch may hold
  const entries = Array.from({ length: 20 }, () => entry('journal_entry', 16000));
  for (const batch of batchRawContent(entries)) {
    const total = batch.reduce((n, e) => n + estimateEntryChars(e), 0);
    if (batch.length === 1) continue; // a lone oversized entry is sent whole, by design
    assert.ok(
      total <= MAX_BATCH_CHARS,
      `batch of ${batch.length} totals ${total}, over the ${MAX_BATCH_CHARS} budget`,
    );
  }
});

test('one entry larger than the whole budget is still sent, alone', () => {
  const batches = batchRawContent([entry('onboarding_profile', 20000)]);
  assert.equal(batches.length, 1);
  assert.equal(batches[0]!.length, 1);
});

test('the budget leaves room for the largest single entry plus overhead', () => {
  // The ceiling that started this: ~10k tokens of fixed prompt overhead plus the
  // batch itself must stay under a 30k tokens-per-minute limit. At roughly
  // 3.8 chars per token, 35000 chars is ~9.2k tokens -> ~19k total. Comfortable.
  const approxTokens = MAX_BATCH_CHARS / 3.8 + 10_000;
  assert.ok(approxTokens < 30_000, `estimated ${Math.round(approxTokens)} tokens exceeds the 30k ceiling`);
});
