import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCitations, type EvidencePack } from '../src/brain/evidence-pack';
import { HISTORICAL_AGENT_SYSTEM_PROMPT } from '../src/prompts/historical-agent-system';

const pack = {
  allowedPatternIds: ['p1', 'p2'],
  allowedAssertionIds: ['a1', 'a2', 'a3'],
} as unknown as EvidencePack;

// ── The constraint that replaces "don't make things up" ─────────────────────

test('a claim citing only pack ids is allowed', () => {
  const r = validateCitations(pack, { patternIds: ['p1'], assertionIds: ['a1', 'a2'] });
  assert.equal(r.ok, true);
});

test('an invented pattern id is caught', () => {
  const r = validateCitations(pack, { patternIds: ['p_invented'] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknownPatternIds, ['p_invented']);
});

test('a fact the writer never had access to is caught', () => {
  const r = validateCitations(pack, { assertionIds: ['a1', 'a_elsewhere'] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknownAssertionIds, ['a_elsewhere']);
});

test('citing nothing is valid -- not every sentence is a claim', () => {
  assert.equal(validateCitations(pack, {}).ok, true);
});

// ── The prompt must stop lying about its tools ──────────────────────────────

test('the prompt no longer claims a tool count that was wrong', () => {
  assert.ok(!/AGENT with 5 tools/.test(HISTORICAL_AGENT_SYSTEM_PROMPT),
    'the prompt described 5 tools while 7 were registered');
});

test('the prompt forbids inventing a pattern', () => {
  assert.match(HISTORICAL_AGENT_SYSTEM_PROMPT, /PATTERNS ARE RETRIEVED, NEVER INVENTED/);
});

test('notRealizedYet must carry a pattern id', () => {
  assert.match(HISTORICAL_AGENT_SYSTEM_PROMPT, /patternId/);
});

test('an empty array is offered as the honest answer', () => {
  assert.match(HISTORICAL_AGENT_SYSTEM_PROMPT, /empty array is an honest answer/);
});

test('gaps are a required output, not a nicety', () => {
  assert.match(HISTORICAL_AGENT_SYSTEM_PROMPT, /"gaps"/);
});
