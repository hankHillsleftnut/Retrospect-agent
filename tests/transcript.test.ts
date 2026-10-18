import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownTurns, parseTranscript } from '../src/questions/transcript';

const SAMPLE = `Meeting Title: Career path with Francis
Date: Sep 27

Transcript:
Them: Venture funds have some of the worst returns.
Me: Yeah.
Me: I would regret it if I didn't try to start a company right now.
Them: Mm-hmm.
Me: Mm-hmm. Okay, yeah.
[NOT INCLUDED -- note added by Claude: the final section was left out.]
Me: I'm halfway to crying right now. That's how much this matters to me.`;

test("only the person's own turns are kept -- never the other speaker's", () => {
  const turns = ownTurns(parseTranscript(SAMPLE).turns);
  assert.deepEqual(turns, [
    "I would regret it if I didn't try to start a company right now.",
    "I'm halfway to crying right now. That's how much this matters to me.",
  ]);
  assert.equal(turns.some((t) => t.includes('Venture funds')), false);
});

test('filler turns are dropped', () => {
  const turns = ownTurns(parseTranscript(SAMPLE).turns);
  assert.equal(turns.some((t) => /^(Yeah|Mm-hmm)/.test(t)), false);
});

test('an unlabelled note is never attributed to anyone', () => {
  const { turns, title } = parseTranscript(SAMPLE);
  assert.equal(turns.some((t) => t.text.includes('NOT INCLUDED')), false);
  assert.equal(title, 'Career path with Francis');
});
