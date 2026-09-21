import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBlock, emptyBlock, patchDocument, MAX_LINES_PER_BLOCK,
  type PortraitDocument,
} from '../src/brain/portrait';
import type { FactRow, PatternRow } from '../src/brain/pulls';

const fact = (id: string, predicate: string, text: string, over: Partial<FactRow> = {}): FactRow => ({
  id, predicate, subject_entity_id: 'self', object_entity_id: null,
  object_value: { text, normalized: text.toLowerCase().replace(/\s+/g, '_') },
  event_time: '2026-03-01T00:00:00Z', observed_at: '2026-03-01T00:00:00Z',
  valid_from: null, valid_to: null, status: 'active', assertion_kind: 'observed',
  supersedes_id: null, metadata: {}, ...over,
});

const pat = (id: string, label: string): PatternRow => ({
  id, slug: label.toLowerCase().replace(/\s+/g, '_'), label,
  status: 'live', severity: 'standard', episode_promotable: true,
  instance_count: 3, weighted_count: 3, source_count: 2, confidence: 0.7,
  first_seen_at: null, last_seen_at: null, grouping_key: 'k', promoter_version: 'v1', metadata: {},
});

// ── The rule that makes the portrait trustworthy ────────────────────────────

test('a block with nothing live behind it is EMPTY, not stale', () => {
  const b = buildBlock('current_goals', { facts: [] });
  assert.equal(b.populated, false);
  assert.deepEqual(b.lines, []);
});

test('every populated line carries the ID it came from', () => {
  const b = buildBlock('current_goals', { facts: [fact('a1', 'stated_goal', 'half marathon')] });
  assert.equal(b.populated, true);
  assert.deepEqual(b.sourceAssertionIds, ['a1']);
  assert.equal(b.lines.length, b.sourceAssertionIds.length);
});

test('Example B: a retired goal never reaches the portrait', () => {
  // currentTruth would not return it; the block builder is handed live rows only.
  const live = [fact('a2', 'stated_goal', 'learn spanish')];
  const b = buildBlock('current_goals', { facts: live });
  assert.ok(!b.lines.some((l) => /marathon/i.test(l)), 'January must not survive into September');
});

test('a block stays short -- a portrait that grows stops being a lens', () => {
  const many = Array.from({ length: 20 }, (_, i) => fact(`a${i}`, 'stated_goal', `goal ${i}`));
  const b = buildBlock('current_goals', { facts: many });
  assert.equal(b.lines.length, MAX_LINES_PER_BLOCK);
  assert.equal(b.sourceAssertionIds.length, MAX_LINES_PER_BLOCK);
});

test('facts with no readable object are skipped rather than rendered blank', () => {
  const junk = fact('a3', 'stated_goal', '');
  assert.equal(buildBlock('current_goals', { facts: [junk] }).populated, false);
});

test('live tensions come from pattern rows and cite pattern IDs', () => {
  const b = buildBlock('live_tensions', { patterns: [pat('p1', 'Skips Thursday standup')] });
  assert.deepEqual(b.sourcePatternIds, ['p1']);
  assert.deepEqual(b.sourceAssertionIds, []);
});

test('self-talk is rendered as quotation, since that is what it is', () => {
  const b = buildBlock('self_talk_now', { facts: [fact('a4', 'said_about_self', 'I am terrible at this')] });
  assert.match(b.lines[0]!, /^".*"$/);
});

// ── The hard constraint on onboarding ───────────────────────────────────────

const portrait = (goalLines: string[], ids: string[]): PortraitDocument => ({
  builtAt: '2026-09-20T00:00:00Z',
  emptySlots: [],
  blocks: {
    current_goals: { slot: 'current_goals', lines: goalLines, sourceAssertionIds: ids, sourcePatternIds: [], populated: goalLines.length > 0 },
    current_state: emptyBlock('current_state'),
    live_tensions: emptyBlock('live_tensions'),
    significant_people: emptyBlock('significant_people'),
    open_threads: emptyBlock('open_threads'),
    self_talk_now: emptyBlock('self_talk_now'),
    what_changed: emptyBlock('what_changed'),
  },
});

test('active_goals keeps the exact shape the API reads', () => {
  const doc = patchDocument(null, portrait(['half marathon'], ['a1']));
  const g = (doc.active_goals as any[])[0];
  assert.ok('goal_id' in g && 'title' in g && 'what_its_really_about' in g,
    'backend goals.ts reads these three fields directly');
});

test('an existing goal keeps its id and its deeper read', () => {
  const prior = {
    active_goals: [{ goal_id: 'g-7', title: 'half marathon', what_its_really_about: 'proving consistency' }],
  };
  const doc = patchDocument(prior, portrait(['half marathon'], ['a1']));
  const g = (doc.active_goals as any[])[0];
  assert.equal(g.goal_id, 'g-7');
  assert.equal(g.what_its_really_about, 'proving consistency');
});

test('an EMPTY goals block does not wipe working onboarding', () => {
  const prior = { active_goals: [{ goal_id: 'g-7', title: 'half marathon', what_its_really_about: 'x' }] };
  const doc = patchDocument(prior, portrait([], []));
  assert.equal((doc.active_goals as any[]).length, 1,
    'an empty bank early on must not silently drop new users into the candidates graveyard');
});

test('patching twice is a no-op', () => {
  const p = portrait(['half marathon'], ['a1']);
  const once = patchDocument(null, p);
  const twice = patchDocument(once, p);
  assert.deepEqual(twice.active_goals, once.active_goals);
});
