/** Gate W2 (cases declared before code, #54): 0 wrong links, >= 80% true links, all ambiguous held. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scorePair, type Mention, type NameContext } from '../src/people/resolve';

const gate = JSON.parse(readFileSync('tests/fixtures/gates/w2-people.json', 'utf8')) as {
  cases: Array<{ id: string; a: Record<string, unknown>; b: Record<string, unknown>; context?: string; expect: 'link' | 'hold' | 'separate' }>;
};

// The cases' prose context, as the numbers the scorer reads.
const CONTEXT: Record<string, NameContext> = {
  p1: { firstNameCount: 1, fullNameCount: 1 }, p3: { firstNameCount: 2, fullNameCount: 1 },
  p5: { firstNameCount: 1, fullNameCount: 1 }, p7: { firstNameCount: 2, fullNameCount: 2 },
  p9: { firstNameCount: 2, fullNameCount: 1 }, p10: { firstNameCount: 1, fullNameCount: 1 },
};
const mention = (m: Record<string, unknown>, id: string): Mention => ({
  name: m.name as string | undefined, email: m.email as string | undefined, source: m.source as string | undefined,
  coOccursWith: m.co_occurs_with as string[] | undefined, transcriptConfidence: m.transcript_confidence as number | undefined,
  kind: id === 'p11' ? 'organisation' : 'person',
});

test('gate W2: 0 wrong links, >= 80% of true links found, every ambiguous case held', () => {
  const results = gate.cases.map((c) => ({ c, got: scorePair(mention(c.a, c.id), mention(c.b, c.id), CONTEXT[c.id] ?? { firstNameCount: 1, fullNameCount: 1 }) }));
  const wrongLinks = results.filter((r) => r.got.decision === 'link' && r.c.expect !== 'link').map((r) => r.c.id);
  const trueLinks = results.filter((r) => r.c.expect === 'link');
  const found = trueLinks.filter((r) => r.got.decision === 'link').length;
  const unheld = results.filter((r) => r.c.expect === 'hold' && r.got.decision !== 'hold').map((r) => `${r.c.id}:${r.got.decision}`);
  assert.deepEqual(wrongLinks, [], 'wrong links');
  assert.ok(found / trueLinks.length >= 0.8, `true links ${found}/${trueLinks.length}`);
  assert.deepEqual(unheld, [], 'ambiguous cases must be held');
  const all = results.filter((r) => r.got.decision !== r.c.expect).map((r) => `${r.c.id}: expected ${r.c.expect}, got ${r.got.decision} (${r.got.signals.join('; ')})`);
  assert.deepEqual(all, [], 'every case');
});

test('a person never links to an organisation', () => {
  assert.equal(scorePair({ name: 'Acme', kind: 'organisation' }, { name: 'Acme', kind: 'person' }, { firstNameCount: 1, fullNameCount: 1 }).decision, 'separate');
});

test('a role word against a name is held, unless the email is the same; the same role word twice is one reference', () => {
  const ctx = { firstNameCount: 1, fullNameCount: 1 };
  assert.equal(scorePair({ name: 'Mom' }, { name: 'Anita Narayan', coOccursWith: [] }, ctx).decision, 'hold');
  assert.equal(scorePair({ name: 'Mom' }, { name: 'mom' }, ctx).decision, 'link');
  assert.equal(scorePair({ name: 'Mom', email: 'a@x.com' }, { name: 'Anita', email: 'a@x.com' }, ctx).decision, 'link');
});
