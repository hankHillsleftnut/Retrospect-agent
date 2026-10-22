/** F1.3: any claim walks down to the source rows it rests on, against a database built from the migrations. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { walkEvidence } from '../src/brain/lineage';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const key = () => Math.random().toString(36).slice(2);
const one = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;

async function person() {
  const user = await insertUser(db);
  const self = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user]);
  const item = (content: string) =>
    one(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', $2) RETURNING id`, [user, content]);
  const fact = (evidence: unknown[]) => one(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify({
    user_id: user, subject_entity_id: self, predicate: 'skipped_or_avoided',
    object_value: { normalized: `standup-${key()}` }, origin_key: `k-${key()}`, evidence,
  })]);
  const pattern = async (factIds: string[]) => {
    const id = await one(`INSERT INTO behavior_patterns (user_id, slug, label, grouping_key, status) VALUES ($1, $2, 'Skips standup', $3, 'live') RETURNING id`,
      [user, `p-${key()}`, `skipped_or_avoided:${key()}`]);
    for (const f of factIds) await db.query(`INSERT INTO behavior_pattern_facts (pattern_id, assertion_id, user_id) VALUES ($1, $2, $3)`, [id, f, user]);
    return id;
  };
  const answer = (evidence: unknown[]) => one(`SELECT record_answer($1::jsonb) AS id`, [JSON.stringify({
    user_id: user, question_id: 13, answer: 'an answer', derived_by: 'first_pass', derivation_key: `d-${key()}`, evidence,
  })]);
  return { user, item, fact, pattern, answer };
}

test('an answer walks through its pattern and facts to the entries they came from', async () => {
  const p = await person();
  const [e1, e2] = [await p.item('I skipped standup'), await p.item('Skipped standup again')];
  const [f1, f2] = [await p.fact([{ raw_content_id: e1, excerpt: 'I skipped standup' }]), await p.fact([{ raw_content_id: e2, excerpt: 'Skipped standup again' }])];
  const pat = await p.pattern([f1, f2]);
  const ans = await p.answer([{ pattern_id: pat }]);

  const lineage = await walkEvidence(p.user, { kind: 'answer', id: ans });
  assert.deepEqual(lineage.sources.map((s) => s.id).sort(), [e1, e2].sort());
  assert.ok(lineage.sources.every((s) => s.kind === 'raw_content'));
  assert.deepEqual(lineage.steps.map((s) => `${s.from.kind}->${s.to.kind}`).sort(),
    ['answer->pattern', 'fact->raw_content', 'fact->raw_content', 'pattern->fact', 'pattern->fact']);
  assert.ok(lineage.steps.some((s) => s.excerpt === 'Skipped standup again'));
});

test('an answer citing an entry directly and a fact reaches both sources, each once', async () => {
  const p = await person();
  const e1 = await p.item('Standup again, skipped');
  const f1 = await p.fact([{ raw_content_id: e1, excerpt: 'skipped' }]);
  const ans = await p.answer([{ raw_content_id: e1 }, { assertion_id: f1 }]);
  const lineage = await walkEvidence(p.user, { kind: 'answer', id: ans });
  assert.deepEqual(lineage.sources, [{ kind: 'raw_content', id: e1 }]);
});

test('a pattern with no facts rests on nothing, and says so', async () => {
  const p = await person();
  const pat = await p.pattern([]);
  const lineage = await walkEvidence(p.user, { kind: 'pattern', id: pat });
  assert.deepEqual(lineage, { sources: [], steps: [] });
});

test('review fix: a pattern resting on hundreds of facts is walked in chunks', async () => {
  const p = await person();
  const facts: string[] = [];
  const e = await p.item('one long conversation');
  for (let i = 0; i < 230; i++) facts.push(await p.fact([{ raw_content_id: e, excerpt: 'one long conversation' }]));
  const pat = await p.pattern(facts);
  const lineage = await walkEvidence(p.user, { kind: 'pattern', id: pat });
  assert.deepEqual(lineage.sources, [{ kind: 'raw_content', id: e }]);
  assert.equal(lineage.steps.filter((s) => s.from.kind === 'fact').length, 230);
});
