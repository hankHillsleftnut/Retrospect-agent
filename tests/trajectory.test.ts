/** W3.3: pattern trajectory against the gate cases declared before code (#54). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trajectoryOf, windowCounts } from '../src/brain/trajectory';

const gate = JSON.parse(readFileSync('tests/fixtures/gates/w3-trajectory.json', 'utf8')) as {
  cases: Array<{ id: string; prior: number; recent: number; recent_days?: number; expect: string }>;
};

test('gate W3: >= 80% of cases right, and 0 change claims the evidence does not support', () => {
  const results = gate.cases.map((c) => ({ c, got: trajectoryOf(c.prior, c.recent, 28, c.recent_days ?? 28).trajectory }));
  const right = results.filter((r) => r.got === r.c.expect).length;
  const unsupported = results.filter((r) => (r.got === 'weakening' || r.got === 'strengthening') && r.got !== r.c.expect);
  assert.deepEqual(unsupported, []);
  assert.ok(right / results.length >= 0.8, `${right}/${results.length}`);
  // The known misses, recorded so a change in either direction is noticed: both
  // say "not enough to say yet" where the case hoped for a change (p 0.06, 0.30).
  assert.deepEqual(results.filter((r) => r.got !== r.c.expect).map((r) => `${r.c.id}:${r.got}`), ['r11:insufficient', 'r12:insufficient']);
});

test('it can say a pattern got worse, and says so the same way', () => {
  assert.equal(trajectoryOf(3, 14).trajectory, 'strengthening');
  assert.equal(trajectoryOf(14, 3).trajectory, 'weakening');
});

test('the counts travel with the verdict', () => {
  assert.deepEqual(trajectoryOf(12, 2), { trajectory: 'weakening', prior: 12, recent: 2, priorDays: 28, recentDays: 28, ratio: 0.17, p: 0.013 });
});

test('instances fall into the right window', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  assert.deepEqual(windowCounts(['2026-10-18T00:00:00Z', '2026-09-30T00:00:00Z', '2026-09-10T00:00:00Z', '2026-07-01T00:00:00Z'], now), { prior: 1, recent: 2 });
});

import { distinctInstances, coverageMatched, refreshTrajectories } from '../src/brain/run-trajectory';
import { freshDatabase, insertUser } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

test('W3.3c: one item with many facts is one instance a day', () => {
  const many = Array.from({ length: 10 }, (_, k) => ({ sourceKey: 'conv', contentType: 'conversation', at: `2026-10-15T0${k % 10}:00:00Z` }));
  assert.equal(distinctInstances(many).length, 1);
});

test('W3.3c: a source connected this month cannot make a pattern look stronger', () => {
  const inst = [{ sourceKey: 'g1', contentType: 'gmail', at: '2026-10-10T00:00:00Z' }, { sourceKey: 'j1', contentType: 'journal_entry', at: '2026-10-10T00:00:00Z' }];
  assert.deepEqual(coverageMatched(inst, new Set(['own_words'])).map((i) => i.sourceKey), ['j1']);
});

test('W3.3c, against the database: the two artifacts found on 19 Oct read "not enough to say"', async () => {
  const { db } = await freshDatabase();
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const user = await insertUser(db);
  const now = new Date('2026-10-19T12:00:00Z');
  const one = async (sql: string, p: unknown[]) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;
  const self = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user]);
  const item = (type: string, at: string) => one(`INSERT INTO raw_content (user_id, content_type, content, created_at) VALUES ($1, $2, $3, $4) RETURNING id`, [user, type, `${type} ${at}`, at]);
  const pattern = await one(`INSERT INTO behavior_patterns (user_id, slug, label, grouping_key, status) VALUES ($1, 's', 'l', 'k:x', 'live') RETURNING id`, [user]);
  let k = 0;
  const fact = async (rc: string, type: string, at: string) => {
    const f = await one(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify({
      user_id: user, subject_entity_id: self, predicate: 'skipped_or_avoided', object_value: { normalized: `x${++k}` },
      origin_key: `o${k}`, event_time: at, metadata: { raw_content_id: rc, content_type: type }, evidence: [{ raw_content_id: rc, excerpt: type }] })]);
    await db.query(`INSERT INTO behavior_pattern_facts (pattern_id, assertion_id, user_id) VALUES ($1, $2, $3)`, [pattern, f, user]);
  };
  // Before: one journal entry. Recently: one long conversation (12 facts) and a
  // newly connected mailbox's history (8 facts).
  await fact(await item('journal_entry', '2026-09-10T12:00:00Z'), 'journal_entry', '2026-09-10T12:00:00Z');
  const conv = await item('conversation', '2026-10-12T12:00:00Z');
  for (let i = 0; i < 12; i++) await fact(conv, 'conversation', '2026-10-12T12:00:00Z');
  for (let i = 0; i < 8; i++) await fact(await item('gmail', `2026-10-1${i}T12:00:00Z`), 'gmail', `2026-10-1${i}T12:00:00Z`);

  await refreshTrajectories(user, supabase, now);
  const { rows } = await db.query<{ trajectory: string; trajectory_detail: { prior: number; recent: number; instancesLeftOut: number } }>(
    `SELECT trajectory, trajectory_detail FROM behavior_patterns WHERE id = $1`, [pattern]);
  assert.equal(rows[0]!.trajectory, 'insufficient', JSON.stringify(rows[0]));
  assert.equal(rows[0]!.trajectory_detail.instancesLeftOut, 19, '11 repeat conversation facts + 8 from a source not yet connected before');
});
