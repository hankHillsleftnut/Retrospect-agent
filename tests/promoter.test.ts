import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGroup, groupFacts, groupingKey, sourceWeight,
  decayedConfidence, shouldDemote, type FactForPromotion,
} from '../src/brain/promoter';

const f = (o: Partial<FactForPromotion> & { object: string; eventTime: string }): FactForPromotion => ({
  assertionId: Math.random().toString(36).slice(2),
  predicate: 'skipped_or_avoided',
  sourceId: Math.random().toString(36).slice(2),
  contentType: 'journal_entry',
  severity: 'standard',
  ...o,
});

// ── Example A: three Thursdays, described differently each time ──────────────

const THURSDAYS = [
  f({ object: 'thursday_standup', eventTime: '2026-02-12T09:00:00Z' }),
  f({ object: 'standup_invite_ignored', eventTime: '2026-02-19T09:00:00Z' }),
  f({ object: 'couldnt_face_standup', eventTime: '2026-02-26T09:00:00Z' }),
];

test('three Thursday skips become EXACTLY one live pattern', () => {
  const groups = groupFacts(THURSDAYS);
  assert.equal(groups.size, 1, 'not three patterns, not zero');
  const d = evaluateGroup([...groups.values()][0]!)!;
  assert.equal(d.status, 'live');
  assert.equal(d.instanceCount, 3);
});

test('one skip creates zero live patterns', () => {
  const d = evaluateGroup([THURSDAYS[0]!])!;
  assert.equal(d.status, 'candidate');
});

test('two skips are still only a candidate', () => {
  const d = evaluateGroup(THURSDAYS.slice(0, 2))!;
  assert.equal(d.status, 'candidate');
});

test('three skips inside one week from one source do not promote', () => {
  const src = 'same-source';
  const tight = ['2026-02-12', '2026-02-13', '2026-02-14'].map((d) =>
    f({ object: 'thursday_standup', eventTime: `${d}T09:00:00Z`, sourceId: src }));
  assert.equal(evaluateGroup(tight)!.status, 'candidate');
});

// ── The over-merge trap: two avoidance-flavoured loops must stay apart ───────

const PRIYA = [
  f({ object: 'dinner_with_priya', eventTime: '2026-02-14T19:00:00Z' }),
  f({ object: 'priya_plans_next_week', eventTime: '2026-02-21T19:00:00Z' }),
  f({ object: 'priya_thing_bailed', eventTime: '2026-03-01T19:00:00Z' }),
];

test('standup and Priya are TWO patterns, never one "avoidance"', () => {
  const groups = groupFacts([...THURSDAYS, ...PRIYA]);
  assert.equal(groups.size, 2, 'one merged mega-pattern is the failure mode');
  for (const g of groups.values()) assert.equal(evaluateGroup(g)!.status, 'live');
});

test('unrelated loops never share a grouping key', () => {
  assert.notEqual(groupingKey(THURSDAYS[0]!), groupingKey(PRIYA[0]!));
});

// ── The coincidence guard: corpus 2's hardest case ──────────────────────────

test('three cancellations with three good reasons do NOT promote', () => {
  // The sharp version of the trap: same person, same commitment type, three
  // misses in five weeks -- structurally identical to a real avoidance loop.
  // The only thing separating them is that each has its own external cause.
  const bad_luck = [
    f({ object: 'priya_dinner', eventTime: '2026-04-05T19:00:00Z', externalCause: 'flight_delayed' }),
    f({ object: 'priya_climbing', eventTime: '2026-04-22T19:00:00Z', externalCause: 'fever' }),
    f({ object: 'priya_drinks', eventTime: '2026-05-06T19:00:00Z', externalCause: 'funeral' }),
  ];
  const groups = groupFacts(bad_luck);
  assert.equal(groups.size, 1, 'these genuinely look like one loop -- that is the trap');
  const d = evaluateGroup([...groups.values()][0]!)!;
  assert.equal(d.status, 'candidate', 'a flight, a fever and a funeral is not a loop');
  assert.match(d.reason, /coincidence/);
});

test('one shared cause across instances is NOT treated as coincidence', () => {
  // Three misses all blamed on "work" is a loop wearing an excuse.
  const excuse = [
    f({ object: 'priya_dinner', eventTime: '2026-04-05T19:00:00Z', externalCause: 'work' }),
    f({ object: 'priya_climbing', eventTime: '2026-04-22T19:00:00Z', externalCause: 'work' }),
    f({ object: 'priya_drinks', eventTime: '2026-05-06T19:00:00Z', externalCause: 'work' }),
  ];
  assert.equal(evaluateGroup([...groupFacts(excuse).values()][0]!)!.status, 'live');
});

test('the same three misses with no stated cause DO promote', () => {
  const real = PRIYA.map((x) => ({ ...x, externalCause: null }));
  assert.equal(evaluateGroup(real)!.status, 'live');
});

// ── Severity ────────────────────────────────────────────────────────────────

test('extreme severity is stored and never episode-promotable', () => {
  const rupture = [f({ object: 'relationship_ended_mara', eventTime: '2026-03-19T20:00:00Z', severity: 'extreme' })];
  const d = evaluateGroup(rupture)!;
  assert.equal(d.status, 'candidate');
  assert.equal(d.episodePromotable, false);
});

test('high severity promotes on two instances', () => {
  const two = THURSDAYS.slice(0, 2).map((x) => ({ ...x, severity: 'high' as const }));
  assert.equal(evaluateGroup(two)!.status, 'live');
});

test('a self-named loop plus one behaviour clears the high bar, not the standard one', () => {
  const named = [
    f({ object: 'say_yes_then_disappear', eventTime: '2026-03-15T10:00:00Z', predicate: 'said_about_self', namesOwnLoop: true }),
    f({ object: 'say_yes_then_disappear', eventTime: '2026-03-22T10:00:00Z', predicate: 'said_about_self' }),
  ];
  assert.equal(evaluateGroup(named)!.status, 'live');
});

test('a self-named loop ALONE never promotes -- saying it is only a fact', () => {
  const alone = [f({ object: 'say_yes_then_disappear', eventTime: '2026-03-15T10:00:00Z', namesOwnLoop: true })];
  assert.equal(evaluateGroup(alone)!.status, 'candidate');
});

// ── Source cadence ──────────────────────────────────────────────────────────

test('a journal instance outweighs a healthkit instance', () => {
  assert.ok(sourceWeight('journal_entry') > sourceWeight('healthkit') * 5);
});

test('three healthkit rows cannot manufacture a pattern', () => {
  const noisy = ['2026-02-01', '2026-02-10', '2026-02-20'].map((d) =>
    f({ object: 'low_sleep_streak', eventTime: `${d}T07:00:00Z`, contentType: 'healthkit' }));
  const d = evaluateGroup(noisy)!;
  assert.equal(d.status, 'candidate', 'a noisy connector must not invent a loop');
  assert.match(d.reason, /below bar/);
});

test('three journal entries across three weeks do promote', () => {
  assert.equal(evaluateGroup(THURSDAYS)!.status, 'live');
});

// ── Decay: patterns must be able to die ─────────────────────────────────────

const NOW = new Date('2026-09-20T00:00:00Z');

test('confidence falls as the newest evidence ages', () => {
  const fresh = decayedConfidence({ baseConfidence: 0.8, lastSeenAt: '2026-09-19T00:00:00Z', now: NOW });
  const stale = decayedConfidence({ baseConfidence: 0.8, lastSeenAt: '2026-04-01T00:00:00Z', now: NOW });
  assert.ok(fresh > stale);
  assert.ok(fresh > 0.7);
});

test('a loop someone stopped months ago demotes', () => {
  const c = decayedConfidence({ baseConfidence: 0.8, lastSeenAt: '2026-02-26T00:00:00Z', now: NOW });
  assert.equal(shouldDemote(c), true, 'a pattern must not be a life sentence');
});

test('a current loop stays live', () => {
  const c = decayedConfidence({ baseConfidence: 0.8, lastSeenAt: '2026-09-10T00:00:00Z', now: NOW });
  assert.equal(shouldDemote(c), false);
});

// ── Determinism ─────────────────────────────────────────────────────────────

test('re-running the promoter yields the same key and verdict', () => {
  const a = evaluateGroup(THURSDAYS)!;
  const b = evaluateGroup([...THURSDAYS].reverse())!;
  assert.equal(a.groupingKey, b.groupingKey);
  assert.equal(a.status, b.status);
  assert.equal(a.firstSeenAt, b.firstSeenAt, 'order must not change the span');
});
