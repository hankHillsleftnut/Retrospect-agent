import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyExcerpt } from '../src/brain/verify-span';

const JOURNAL = 'I skipped Thursday standup. Told myself I was too tired.';

test('exact quote is accepted with correct offsets', () => {
  const r = verifyExcerpt('I skipped Thursday standup', JOURNAL);
  assert.ok(r.ok);
  assert.equal(r.charStart, 0);
  assert.equal(r.charEnd, 26);
  assert.equal(r.exact, true);
  assert.equal(JOURNAL.slice(r.charStart, r.charEnd), 'I skipped Thursday standup');
});

test('invented quote is rejected', () => {
  const r = verifyExcerpt('I felt ashamed about missing it', JOURNAL);
  assert.equal(r.ok, false);
  assert.equal((r as any).reason, 'not_found');
});

test('a paraphrase sharing most of its words is rejected', () => {
  // This is what a model actually produces when being helpful.
  const r = verifyExcerpt('I skipped the Thursday standup', JOURNAL);
  assert.equal(r.ok, false, 'near-misses must not be forgiven');
});

test('curly quotes match straight ones, offsets still point at the original', () => {
  const src = 'She said “I can’t do this” and left.';
  const r = verifyExcerpt('"I can\'t do this"', src);
  assert.ok(r.ok);
  assert.equal(r.exact, false);
  assert.equal(src.slice(r.charStart, r.charEnd), '“I can’t do this”');
});

test('collapsed whitespace and newlines are forgiven', () => {
  const src = 'I skipped   Thursday\nstandup today.';
  const r = verifyExcerpt('I skipped Thursday standup', src);
  assert.ok(r.ok);
  assert.equal(src.slice(r.charStart, r.charEnd), 'I skipped   Thursday\nstandup');
});

test('leading and trailing whitespace on the excerpt is forgiven', () => {
  const r = verifyExcerpt('   Told myself I was too tired.  ', JOURNAL);
  assert.ok(r.ok);
  assert.equal(JOURNAL.slice(r.charStart, r.charEnd), 'Told myself I was too tired.');
});

test('the same accented word in either unicode form matches', () => {
  const composed = 'We went to the café after.';          // é as one char
  const decomposed = 'café';                          // e + combining accent
  const r = verifyExcerpt(decomposed, composed);
  assert.ok(r.ok);
  assert.equal(composed.slice(r.charStart, r.charEnd), 'café');
});

test('a real quote from a DIFFERENT source row is rejected', () => {
  const other = 'I went to standup and said nothing.';
  const r = verifyExcerpt('Told myself I was too tired.', other);
  assert.equal(r.ok, false);
});

test('empty excerpt is rejected', () => {
  assert.equal(verifyExcerpt('', JOURNAL).ok, false);
  assert.equal(verifyExcerpt('   ', JOURNAL).ok, false);
});

test('a too-short excerpt is rejected even though it appears', () => {
  const r = verifyExcerpt('I', JOURNAL);
  assert.equal(r.ok, false);
  assert.equal((r as any).reason, 'excerpt_too_short');
});

test('empty source is rejected', () => {
  assert.equal(verifyExcerpt('anything', '').ok, false);
});

test('rules can be disabled individually', () => {
  const src = 'I skipped   Thursday standup.';
  assert.equal(verifyExcerpt('I skipped Thursday standup', src, { rules: [] }).ok, false);
  assert.ok(verifyExcerpt('I skipped Thursday standup', src, { rules: ['collapse_whitespace'] }).ok);
});

test('offsets round-trip: the matched text is always really in the source', () => {
  const cases: [string, string][] = [
    [JOURNAL, 'Thursday standup'],
    ['I skipped   Thursday\nstandup today.', 'I skipped Thursday standup'],
    ['She said “no” firmly.', '"no"'],
  ];
  for (const [src, exc] of cases) {
    const r = verifyExcerpt(exc, src);
    assert.ok(r.ok, `expected ${exc} in ${src}`);
    assert.ok(r.charStart >= 0 && r.charEnd <= src.length);
    assert.equal(r.matchedText, src.slice(r.charStart, r.charEnd));
  }
});
