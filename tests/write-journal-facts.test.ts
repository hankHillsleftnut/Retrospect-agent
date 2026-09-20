import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOriginKey, normalizeObject } from '../src/brain/write-journal-facts';
import { verifyExcerpt } from '../src/brain/verify-span';
import type { FactCandidate } from '../src/types';

const JOURNAL = {
  id: 'raw-1',
  content: 'I skipped Thursday standup. Told myself I was too tired.',
  content_type: 'journal_entry',
  content_date: '2026-02-12T09:00:00.000Z',
};

test('origin key is deterministic for the same claim', () => {
  const a = buildOriginKey('raw-1', 'skipped_or_avoided', 'Thursday standup');
  const b = buildOriginKey('raw-1', 'skipped_or_avoided', 'thursday   STANDUP');
  assert.equal(a, b, 'a retry must produce the same key, not a second fact');
  assert.equal(a, 'journal:raw-1:skipped_or_avoided:thursday_standup');
});

test('different claims from the same journal get different keys', () => {
  assert.notEqual(
    buildOriginKey('raw-1', 'skipped_or_avoided', 'standup'),
    buildOriginKey('raw-1', 'said_about_self', 'I was too tired')
  );
});

test('the same claim from a different journal is a different fact', () => {
  assert.notEqual(
    buildOriginKey('raw-1', 'skipped_or_avoided', 'standup'),
    buildOriginKey('raw-2', 'skipped_or_avoided', 'standup')
  );
});

test('object normalization strips quotes and punctuation', () => {
  assert.equal(normalizeObject('"I’m terrible at this"'), 'im_terrible_at_this');
  assert.equal(normalizeObject('Thursday standup!'), 'thursday_standup');
});

// The gate itself, at candidate level.
const candidates: FactCandidate[] = [
  { subject: 'Self', predicate: 'skipped_or_avoided', object: 'thursday standup',
    excerpt: 'I skipped Thursday standup', source_index: 0 },
  { subject: 'Self', predicate: 'said_about_self', object: 'too tired',
    excerpt: 'Told myself I was too tired', source_index: 0 },
  { subject: 'Self', predicate: 'felt', object: 'ashamed',
    excerpt: 'I felt deeply ashamed about it', source_index: 0 }, // invented
];

test('a fixture journal yields the two real claims and rejects the invented one', () => {
  const kept = candidates.filter((c) => verifyExcerpt(c.excerpt, JOURNAL.content).ok);
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map((c) => c.predicate), ['skipped_or_avoided', 'said_about_self']);
});

test('every kept excerpt really is in the journal, at the offsets recorded', () => {
  for (const c of candidates) {
    const r = verifyExcerpt(c.excerpt, JOURNAL.content);
    if (!r.ok) continue;
    assert.equal(JOURNAL.content.slice(r.charStart, r.charEnd), r.matchedText);
  }
});

test('a tampered excerpt produces zero facts', () => {
  const tampered = { ...candidates[0], excerpt: 'I skipped Friday standup' };
  assert.equal(verifyExcerpt(tampered.excerpt, JOURNAL.content).ok, false);
});
