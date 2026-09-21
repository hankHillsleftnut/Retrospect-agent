import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardTranscript, findPrediction, renderTranscript } from '../src/brain/transcript-guard';
import type { EvidencePack } from '../src/brain/evidence-pack';
import { FINAL_TRANSCRIPT_SYSTEM_PROMPT } from '../src/prompts/final-transcript';

const pack = {
  allowedPatternIds: ['p1'],
  allowedAssertionIds: ['a1', 'a2', 'a3'],
  gaps: ['no calendar data in this period'],
} as unknown as EvidencePack;

const ok = {
  segments: [
    { text: 'Three Thursdays running, you did not make it to standup.',
      cites: { patternIds: ['p1'], assertionIds: ['a1', 'a2'] } },
    { text: 'So what was going on there?', cites: {} },
    { text: 'There is nothing from your calendar this week.',
      cites: { gap: 'no calendar data in this period' } },
  ],
};

// ── Acceptance test 9 ───────────────────────────────────────────────────────

test('a transcript citing only pack ids passes', () => {
  assert.equal(guardTranscript({ transcript: ok, pack }).ok, true);
});

test('a pattern that is not in the pack is caught', () => {
  const bad = { segments: [
    { text: 'You have a real avoidance streak.', cites: { patternIds: ['p_invented'] } },
    { text: 'No calendar data.', cites: { gap: 'x' } },
  ] };
  const r = guardTranscript({ transcript: bad, pack });
  assert.equal(r.ok, false);
  assert.equal(r.violations[0]!.kind, 'unknown_pattern');
});

test('a fact the writer never had is caught', () => {
  const bad = { segments: [
    { text: 'You said you felt ashamed.', cites: { assertionIds: ['a_elsewhere'] } },
    { text: 'No calendar data.', cites: { gap: 'x' } },
  ] };
  assert.equal(guardTranscript({ transcript: bad, pack }).violations[0]!.kind, 'unknown_assertion');
});

// ── Prediction is out of scope ──────────────────────────────────────────────

test('forecasting is refused', () => {
  for (const line of [
    "Next week you'll skip it again.",
    "You're going to avoid that conversation.",
    "I predict this continues.",
    "You'll probably struggle with that.",
  ]) {
    assert.ok(findPrediction(line), `should flag: ${line}`);
  }
});

test('describing the past is not a prediction', () => {
  for (const line of [
    'Three Thursdays running, you did not make it.',
    'You told yourself you were too tired.',
    'What would make next Thursday different?',
  ]) {
    assert.equal(findPrediction(line), null, `should NOT flag: ${line}`);
  }
});

test('a prediction inside an otherwise valid transcript still fails', () => {
  const bad = { segments: [
    { text: 'Three Thursdays running.', cites: { patternIds: ['p1'] } },
    { text: "Next week you'll skip it again.", cites: {} },
    { text: 'No calendar data.', cites: { gap: 'x' } },
  ] };
  const r = guardTranscript({ transcript: bad, pack });
  assert.ok(r.violations.some((v) => v.kind === 'prediction'));
});

// ── Gaps are product ────────────────────────────────────────────────────────

test('an episode that never admits a known blind spot fails', () => {
  const silent = { segments: [{ text: 'Three Thursdays.', cites: { patternIds: ['p1'] } }] };
  const r = guardTranscript({ transcript: silent, pack });
  assert.ok(r.violations.some((v) => v.kind === 'missing_gap_disclosure'));
});

test('no known gaps means nothing to disclose', () => {
  const noGaps = { ...pack, gaps: [] } as unknown as EvidencePack;
  const r = guardTranscript({ transcript: { segments: [{ text: 'Hello.', cites: {} }] }, pack: noGaps });
  assert.equal(r.ok, true);
});

// ── Groundedness becomes a number ───────────────────────────────────────────

test('groundedness is computed, not estimated', () => {
  const r = guardTranscript({ transcript: ok, pack });
  assert.equal(r.totalSegments, 3);
  assert.equal(r.citedSegments, 2);
  assert.ok(Math.abs(r.groundednessRate - 0.667) < 0.01);
});

test('a transcript of pure improvisation scores zero and is visible as such', () => {
  const vibes = { segments: [
    { text: 'You seem like someone who cares deeply.', cites: {} },
    { text: 'Growth is a journey.', cites: {} },
  ] };
  const r = guardTranscript({ transcript: vibes, pack, requireGapDisclosure: false });
  assert.equal(r.groundednessRate, 0);
});

test('uncited segments are allowed -- not every sentence is a claim', () => {
  const r = guardTranscript({ transcript: ok, pack });
  assert.ok(r.ok, 'a question with no citation must not be a violation');
});

test('rendering drops the citations and keeps the words', () => {
  const text = renderTranscript(ok);
  assert.match(text, /Three Thursdays/);
  assert.ok(!text.includes('p1'));
});

// ── The prompt carries the rules ────────────────────────────────────────────

test('Cook C is told not to name a pattern outside the pack', () => {
  assert.match(FINAL_TRANSCRIPT_SYSTEM_PROMPT, /NAME NO PATTERN THAT IS NOT IN THE PACK/);
});

test('Cook C is told not to predict', () => {
  assert.match(FINAL_TRANSCRIPT_SYSTEM_PROMPT, /DO NOT PREDICT/);
});

test('Cook C keeps the founder heuristic about not always naming it', () => {
  assert.match(FINAL_TRANSCRIPT_SYSTEM_PROMPT, /DON'T ALWAYS NAME THE REALISATION/);
});
