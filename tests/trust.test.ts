/** W1 gate: trust classes, judged against the fixtures written before this code. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyTrust, isAutomatedSender } from '../src/brain/trust';

const gate = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'gates', 'w1-trust-classes.json'), 'utf8'));

test('W1 gate: every case gets its expected class (bar: 100%)', () => {
  const wrong: string[] = [];
  for (const c of gate.cases) {
    const v = classifyTrust({ content_type: c.content_type, authorship: c.authorship, labels: c.labels, from: c.from, text: c.text });
    if (v.trustClass !== c.expect_class) wrong.push(`${c.id}: got ${v.trustClass}, expected ${c.expect_class}`);
  }
  assert.deepEqual(wrong, []);
});

test('W1 gate: zero inner-life claims from anything but the person\'s own words', () => {
  for (const c of gate.cases) {
    const v = classifyTrust({ content_type: c.content_type, authorship: c.authorship, labels: c.labels, from: c.from, text: c.text });
    assert.equal(v.mayClaimInnerLife, c.may_claim_inner_life, c.id);
  }
});

test('a human sender is not mistaken for a machine', () => {
  assert.equal(isAutomatedSender('Priya Raman <priya@example.com>'), false);
  assert.equal(isAutomatedSender('Sam Ortiz <sam.o@example.com>'), false);
});

test('machine senders are recognised', () => {
  for (const s of ['Daybreak Assistant <brief@daybreak.ai>', 'no-reply@service.example', 'City Library <circ@library.example>', 'Weekly Digest <digest@news.example>']) {
    assert.equal(isAutomatedSender(s), true, s);
  }
});

test('an unknown content type is never trusted as their own words', () => {
  assert.equal(classifyTrust({ content_type: 'something_new' }).trustClass, 'third_party');
});
