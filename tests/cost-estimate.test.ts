import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateCostUsd } from '../src/pipelines/trace';
import type { CostBreakdown } from '../src/types';

/**
 * These tests exist because the estimator they cover was wrong in three places
 * for months, and nothing caught it. Each case below is one of those errors,
 * written as an assertion so it cannot come back.
 */

function cost(partial: Partial<CostBreakdown>): CostBreakdown {
  return {
    openai_tokens_input: 0,
    openai_tokens_output: 0,
    anthropic_tokens_input: 0,
    anthropic_tokens_output: 0,
    embedding_tokens: 0,
    perplexity_calls: 0,
    elevenlabs_chars: 0,
    est_usd: 0,
    ...partial,
  };
}

test('Anthropic tokens are priced at the model that spent them, not at Opus rates', () => {
  // All three cooks run claude-sonnet-4-6: $3 in / $15 out per million.
  const { usd } = estimateCostUsd(
    cost({
      anthropic_tokens_input: 1_000_000,
      anthropic_tokens_output: 1_000_000,
      by_model: { 'claude-sonnet-4-6': { input: 1_000_000, output: 1_000_000 } },
    })
  );

  assert.equal(usd, 18, 'one million tokens each way on Sonnet 4.6 is $3 + $15');

  // The old estimator hardcoded Opus 4 rates ($15/$75) for every Anthropic
  // call, which is exactly 5x this figure. Asserted so the regression is
  // visible rather than implied.
  assert.equal(90 / usd, 5, 'the old constants overstated Anthropic spend 5x');
});

test('a mini model is not billed at full OpenAI rates', () => {
  // Cook A runs gpt-4o-mini: $0.15 in / $0.60 out per million.
  const { usd } = estimateCostUsd(
    cost({
      openai_tokens_input: 1_000_000,
      openai_tokens_output: 1_000_000,
      by_model: { 'gpt-4o-mini': { input: 1_000_000, output: 1_000_000 } },
    })
  );

  assert.equal(usd, 0.75, 'a million each way on gpt-4o-mini is $0.15 + $0.60');

  // The old estimator billed this at $5/$15 — $20 for the same work.
  assert.ok(20 / usd > 26, 'the old constants overstated Cook A spend by more than 26x');
});

test('two models in one run are priced separately', () => {
  const { usd } = estimateCostUsd(
    cost({
      openai_tokens_input: 1_000_000,
      openai_tokens_output: 0,
      anthropic_tokens_input: 1_000_000,
      anthropic_tokens_output: 0,
      by_model: {
        'gpt-4o-mini': { input: 1_000_000, output: 0 },
        'claude-sonnet-4-6': { input: 1_000_000, output: 0 },
      },
    })
  );

  // $0.15 + $3.00. The old shape could not express this at all: it summed
  // tokens per provider and applied one rate to the total.
  assert.equal(usd, 3.15);
});

test('speech is not billed a thousand times under', () => {
  // 10,000 characters at $0.30 per 1,000 is $3.00.
  const { usd } = estimateCostUsd(cost({ elevenlabs_chars: 10_000 }));

  assert.equal(usd, 3, 'ten thousand characters of speech is three dollars');
  assert.notEqual(usd, 0.003, 'the stray 0.001 multiplier is gone');
});

test('embeddings keep their rate, which was already correct', () => {
  const { usd } = estimateCostUsd(cost({ embedding_tokens: 1_000_000 }));
  assert.equal(usd, 0.13);
});

test('an unknown model is reported, not silently guessed', () => {
  const { usd, unpriced } = estimateCostUsd(
    cost({
      anthropic_tokens_input: 1_000_000,
      by_model: { 'claude-sonnet-9-9': { input: 1_000_000, output: 0 } },
    })
  );

  assert.deepEqual(unpriced, ['claude-sonnet-9-9'], 'the model id is surfaced for a human to fix');
  assert.equal(usd, 5, 'and it is priced high rather than free, so it cannot hide');
});

test('tokens with no model attribution are still charged for', () => {
  // A call site that forgets to pass its model, or a row written before
  // by_model existed. The figure is rough, but it must not be zero.
  const { usd } = estimateCostUsd(
    cost({ openai_tokens_input: 1_000_000, openai_tokens_output: 0 })
  );

  assert.equal(usd, 5, 'unattributed tokens fall back rather than vanishing');
});

test('attributed and unattributed tokens are not double-counted', () => {
  // The provider totals and by_model describe the same tokens. Only the
  // difference between them should be treated as unattributed.
  const { usd } = estimateCostUsd(
    cost({
      anthropic_tokens_input: 1_000_000,
      anthropic_tokens_output: 1_000_000,
      by_model: { 'claude-sonnet-4-6': { input: 1_000_000, output: 1_000_000 } },
    })
  );

  assert.equal(usd, 18, 'fully attributed run charges once, at the model rate');
});

test('a realistic weekly episode comes to a believable figure', () => {
  // Cook A outline on gpt-4o-mini, Cook B and Cook C on Sonnet 4.6, one
  // Perplexity call, and roughly six minutes of speech.
  const { usd, unpriced } = estimateCostUsd(
    cost({
      openai_tokens_input: 40_000,
      openai_tokens_output: 4_000,
      anthropic_tokens_input: 180_000,
      anthropic_tokens_output: 20_000,
      embedding_tokens: 12_000,
      perplexity_calls: 1,
      elevenlabs_chars: 6_000,
      by_model: {
        'gpt-4o-mini': { input: 40_000, output: 4_000 },
        'claude-sonnet-4-6': { input: 180_000, output: 20_000 },
      },
    })
  );

  assert.deepEqual(unpriced, [], 'every model in a normal run has a price');

  // Thinking is cents; the speech is dollars. That ratio is the whole argument
  // for spending more on the writing and less on the runtime.
  assert.ok(usd > 2.6 && usd < 2.8, `expected ~$2.70, got $${usd}`);
  const speech = 6_000 * (0.3 / 1000);
  assert.ok(speech / (usd - speech) > 1.8, 'speech dominates the cost of an episode');
});
