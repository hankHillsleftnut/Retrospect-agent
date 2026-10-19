import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferAuthorship, authorshipLabel, type Authorship } from '../src/agents/ingestion-agent';
import { INGESTION_SYSTEM_PROMPT } from '../src/prompts/ingestion';

// The failure this guards against:
//
// Sitting in one account's ingestion queue was a Google Doc beginning "My name
// is Farza. I am going all-in on building a new interface for computers." Every
// gate in the pipeline would have passed it. The model would have proposed a
// claim, the verifier would have confirmed the quote really is in the source,
// and the fact bank would have recorded that the user is going all-in on
// building a new interface for computers -- true of somebody else entirely.
//
// Span verification cannot catch this. It checks that the words exist, not
// whose words they are. Authorship is the only thing that can.

test('what the user writes or says is theirs', () => {
  for (const t of [
    'text_entry', 'journal_entry', 'voice_recording', 'voice_journal',
    'video_entry', 'onboarding_profile',
  ]) {
    assert.equal(inferAuthorship(t), 'self', t);
  }
});

test('sensor streams are nobody\'s writing', () => {
  for (const t of ['healthkit', 'screen_time', 'calendar', 'apple_music', 'photos', 'contacts']) {
    assert.equal(inferAuthorship(t), 'other', t);
  }
});

test('anything a connector fetched is UNKNOWN, never self', () => {
  // The Farza document arrived as google_docs. Had this returned 'self', the
  // whole guard would be decorative.
  for (const t of ['google_docs', 'gmail', 'linkedin', 'reddit', 'spotify', 'pinterest']) {
    assert.equal(inferAuthorship(t), 'unknown', t);
    assert.notEqual(inferAuthorship(t), 'self', `${t} must never be assumed self-authored`);
  }
});

test('an unrecognised source is unknown, not self', () => {
  // A connector added next year must not default into the user's mouth.
  assert.equal(inferAuthorship('some_future_connector'), 'unknown');
  assert.equal(inferAuthorship(''), 'unknown');
});

test('only the self label invites attribution; the others forbid it', () => {
  assert.match(authorshipLabel('self'), /their own words/i);
  for (const a of ['other', 'unknown'] as Authorship[]) {
    assert.match(
      authorshipLabel(a),
      /never attribute|do not attribute/i,
      `${a} must tell the model not to attribute`,
    );
  }
});

test('the system prompt states the rule and the reason', () => {
  // Collapsed first: the prompt is hard-wrapped, and a rule that only matches
  // when the line breaks fall a certain way is a test of the formatter.
  const prompt = INGESTION_SYSTEM_PROMPT.replace(/\s+/g, ' ');
  assert.match(prompt, /\[AUTHORSHIP\]/, 'must reference the label it will see');
  assert.match(prompt, /WRITTEN BY THE USER/);
  assert.match(
    prompt,
    /never put its words in the user's mouth/i,
    'the rule must be stated, not implied',
  );
  assert.match(
    prompt,
    /checks that the words exist in the source, not whose words they are/i,
    'the model should know WHY the verifier cannot save it here',
  );
});
