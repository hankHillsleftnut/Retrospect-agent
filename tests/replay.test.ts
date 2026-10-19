/**
 * F1.5: replay is safe (P3). Reading the same material twice leaves the brain
 * exactly as reading it once: facts, evidence, patterns, whys, answers and the
 * lineage graph. Against a database built from the migrations.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { runPromoter } from '../src/brain/run-promoter';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const one = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;

/** Everything derived for one person, in a form that can be compared. */
async function brainState(user: string) {
  const q = async (sql: string) => (await db.query(sql, [user])).rows;
  return {
    facts: await q(`SELECT predicate, object_value, status FROM assertions WHERE user_id = $1 ORDER BY origin_key`),
    evidence: await q(`SELECT count(*)::int n FROM assertion_evidence e JOIN assertions a ON a.id = e.assertion_id WHERE a.user_id = $1`),
    patterns: await q(`SELECT grouping_key, status, confidence FROM behavior_patterns WHERE user_id = $1 ORDER BY grouping_key`),
    patternFacts: await q(`SELECT count(*)::int n FROM behavior_pattern_facts WHERE user_id = $1`),
    whys: await q(`SELECT count(*)::int n FROM behavior_pattern_whys WHERE user_id = $1`),
    answers: await q(`SELECT question_id, answer, status FROM question_answers WHERE user_id = $1 ORDER BY question_id`),
    edges: await q(`SELECT claim_kind, evidence_kind, count(*)::int n FROM claim_edges WHERE user_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`),
  };
}

test('playing the same material through the brain twice leaves it as once', async () => {
  const user = await insertUser(db);
  const self = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user]);
  const days = ['2026-10-01', '2026-10-06', '2026-10-09', '2026-10-14'];
  const entries: string[] = [];
  for (const d of days) entries.push(await one(
    `INSERT INTO raw_content (user_id, content_type, content, created_at) VALUES ($1, 'journal_entry', $2, $3) RETURNING id`,
    [user, `Skipped standup again (${d})`, d]));

  async function play() {
    const facts: string[] = [];
    for (const [i, e] of entries.entries()) facts.push(await one(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify({
      user_id: user, subject_entity_id: self, predicate: 'skipped_or_avoided',
      object_value: { normalized: 'standup' }, origin_key: `replay-${e}`, event_time: days[i],
      metadata: { raw_content_id: e, content_type: 'journal_entry' },
      evidence: [{ raw_content_id: e, excerpt: 'Skipped standup again' }],
    })]));
    await runPromoter({ userId: user, lookbackDays: 3650 });
    await one(`SELECT record_answer($1::jsonb) AS id`, [JSON.stringify({
      user_id: user, question_id: 13, answer: 'Standup keeps slipping', derived_by: 'first_pass',
      derivation_key: 'replay-q13', evidence: facts.map((f) => ({ assertion_id: f })),
    })]);
  }

  await play();
  const once = await brainState(user);
  assert.equal(once.facts.length, 4, 'the material was read');
  assert.equal(once.patterns.length, 1, 'a pattern was promoted');
  assert.equal(once.answers.length, 1, 'an answer was recorded');
  assert.ok(once.edges.length >= 3, 'and lineage links fact, pattern and answer');

  await play();
  assert.deepEqual(await brainState(user), once);
});
