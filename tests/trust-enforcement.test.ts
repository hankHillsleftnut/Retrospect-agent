/** W1.3 gate: facts about the person survive only if the item's trust class may support them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { factsOnlyResult } from '../src/pipelines/ingest';

const gate = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'gates', 'w1-trust-classes.json'), 'utf8'));
const INNER_LIFE = ['felt', 'believes', 'values', 'said_about_self', 'stated_goal', 'wants_to_learn'];

test('W1.3 gate: zero inner-life facts about the person from anything but their own words', () => {
  for (const c of gate.cases) {
    const row = { content_type: c.content_type, authorship: c.authorship ?? (c.content_type === 'gmail' ? 'other' : undefined), content: c.text, metadata: { labels: c.labels, from: c.from } };
    const kept = factsOnlyResult([row], INNER_LIFE.map((predicate) => ({ subject: 'Self', predicate, source_index: 0 }))).fact_candidates;
    assert.equal(kept.length, c.may_claim_inner_life ? INNER_LIFE.length : 0, `${c.id} (${c.expect_class})`);
  }
});

test('a calendar may still say what they attended; an assistant only what they use', () => {
  const calendar = factsOnlyResult([{ content_type: 'calendar', content: 'Calendar event: Run club' }],
    [{ subject: 'Self', predicate: 'attended', source_index: 0 }, { subject: 'Self', predicate: 'felt', source_index: 0 }]).fact_candidates;
  assert.deepEqual(calendar.map((c: any) => c.predicate), ['attended']);

  const assistant = factsOnlyResult([{ content_type: 'gmail', authorship: 'other', content: 'Your morning brief', metadata: { from: 'Daybreak Assistant <brief@daybreak.ai>' } }],
    [{ subject: 'Self', predicate: 'consumed_or_followed', source_index: 0 }, { subject: 'Self', predicate: 'felt', source_index: 0 }, { subject: 'Self', predicate: 'work_plan', source_index: 0 }]).fact_candidates;
  assert.deepEqual(assistant.map((c: any) => c.predicate), ['consumed_or_followed']);
});

test('facts about someone else are untouched by these rules', () => {
  const kept = factsOnlyResult([{ content_type: 'gmail', authorship: 'other', content: 'x', metadata: { from: 'Priya <priya@example.com>' } }],
    [{ subject: 'Priya', predicate: 'felt', source_index: 0 }]).fact_candidates;
  assert.equal(kept.length, 1);
});
