/** W4.1: one read of what the brain knows; registers decided from counted confidence. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { assembleContract, readUnderstanding, type ContractRows } from '../src/understanding/read';
import { walkEvidence } from '../src/brain/lineage';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';

const rows = (over: Partial<ContractRows> = {}): ContractRows => ({
  coverage: [{ domain_id: 'want', label: 'What they want', may_speak: true }, { domain_id: 'how', label: 'How they are', may_speak: false }],
  domains: [{ id: 'want', confidence_floor: '0.60' }, { id: 'how', confidence_floor: '0.70' }],
  questions: [{ id: 6, domain_id: 'want', text: 'What do they want?' }, { id: 7, domain_id: 'want', text: 'What else?' }, { id: 20, domain_id: 'how', text: 'How are they?' }],
  answers: [
    { id: 'a1', question_id: 6, answer: 'to build', user_verdict: null, last_moved_at: null },
    { id: 'a2', question_id: 7, answer: 'to move', user_verdict: null, last_moved_at: null },
    { id: 'a3', question_id: 7, answer: 'to rest', user_verdict: 'rejected', last_moved_at: null },
    { id: 'a4', question_id: 20, answer: 'tired', user_verdict: null, last_moved_at: null },
  ],
  scores: [
    { answer_id: 'a1', confidence: '0.72', independent_sources: '3' },
    { answer_id: 'a2', confidence: '0.40', independent_sources: '1' },
    { answer_id: 'a3', confidence: '0.95', independent_sources: '5' },
    { answer_id: 'a4', confidence: '0.90', independent_sources: '4' },
  ],
  patterns: [], whys: [], goals: [], summaries: [], ...over,
});

test('registers: over the bar is stated, under it is asked, rejected never appears, silent domains say nothing', () => {
  const c = assembleContract('u', rows(), '2026-10-19');
  assert.deepEqual(c.answers.map((a) => [a.id, a.register]), [['a1', 'stated'], ['a2', 'asked']]);
  assert.deepEqual(c.silent, [{ domainId: 'how', label: 'How they are' }], 'a confident answer in a silent domain is still not spoken');
});

test('a confirmed answer is stated whatever its confidence, and beats a more confident one', () => {
  const c = assembleContract('u', rows({ answers: [
    { id: 'x', question_id: 6, answer: 'confident', user_verdict: null, last_moved_at: null },
    { id: 'y', question_id: 6, answer: 'they said so', user_verdict: 'confirmed', last_moved_at: null },
  ], scores: [{ answer_id: 'x', confidence: 0.9, independent_sources: 4 }, { answer_id: 'y', confidence: 0.1, independent_sources: 1 }] }), '2026-10-19');
  assert.deepEqual(c.answers.map((a) => [a.id, a.register]), [['y', 'stated']]);
});

test('whys are always asked; only live, promotable patterns are read', () => {
  const c = assembleContract('u', rows({
    patterns: [
      { id: 'p1', label: 'skips standup', status: 'live', episode_promotable: true, instance_count: 4, first_seen_at: null, last_seen_at: null, trajectory: 'holding', trajectory_detail: { prior: 4, recent: 4 } },
      { id: 'p2', label: 'candidate', status: 'candidate', episode_promotable: true, instance_count: 1, first_seen_at: null, last_seen_at: null, trajectory: null, trajectory_detail: null },
      { id: 'p3', label: 'extreme', status: 'live', episode_promotable: false, instance_count: 3, first_seen_at: null, last_seen_at: null, trajectory: null, trajectory_detail: null },
    ],
    whys: [{ id: 'w1', pattern_id: 'p1', mechanism: 'avoidance', confidence: '0.6', status: 'live' }, { id: 'w2', pattern_id: 'p1', mechanism: 'capacity', confidence: '0.3', status: 'provisional' }],
  }), '2026-10-19');
  assert.deepEqual(c.patterns.map((p) => p.id), ['p1']);
  assert.deepEqual(c.whys.map((w) => [w.id, w.register]), [['w1', 'asked']]);
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('gate, against the database: every answer, pattern and why it returns walks to a source', async () => {
  const user = await insertUser(db);
  const one = async (sql: string, p: unknown[]) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;
  const self = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user]);
  const entry = await one(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'Be blunt with me. I skipped standup.') RETURNING id`, [user]);
  const speakQ = Number((await db.query<{ id: number }>(`SELECT id FROM canonical_questions WHERE domain_id = 'speak' ORDER BY id LIMIT 1`)).rows[0]!.id);
  await one(`SELECT record_answer($1::jsonb) AS id`, [JSON.stringify({ user_id: user, question_id: speakQ, answer: 'Bluntly', derived_by: 'quote', derivation_key: 'k1', evidence: [{ raw_content_id: entry }] })]);
  const fact = await one(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify({ user_id: user, subject_entity_id: self, predicate: 'skipped_or_avoided', object_value: { normalized: 'standup' }, origin_key: 'o1', evidence: [{ raw_content_id: entry, excerpt: 'I skipped standup' }] })]);
  const pat = await one(`INSERT INTO behavior_patterns (user_id, slug, label, grouping_key, status) VALUES ($1, 's', 'Skips standup', 'k:standup', 'live') RETURNING id`, [user]);
  await db.query(`INSERT INTO behavior_pattern_facts (pattern_id, assertion_id, user_id) VALUES ($1, $2, $3)`, [pat, fact, user]);
  await db.query(`INSERT INTO behavior_pattern_whys (pattern_id, user_id, mechanism, status, evidence_assertion_ids) VALUES ($1, $2, 'avoidance', 'live', ARRAY[$3::uuid])`, [pat, user, fact]);

  const c = await readUnderstanding(user, supabase, new Date('2026-10-19T12:00:00Z'));
  assert.equal(c.answers.length, 1);
  assert.equal(c.patterns.length, 1);
  assert.equal(c.whys.length, 1);
  for (const item of [...c.answers, ...c.patterns, ...c.whys]) {
    const lineage = await walkEvidence({ kind: item.kind, id: item.id });
    assert.deepEqual(lineage.sources.map((s) => s.id), [entry], `${item.kind} ${item.id}`);
  }
});
