/** F-L1 (goal 5): lint runs on a real-sized account without false findings. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { runLint, persistFindings } from '../src/brain/lint';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('2,500 facts, every one with evidence: no fact is reported as having none', async () => {
  const user = await insertUser(db);
  const self = (await db.query<{ id: string }>(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user])).rows[0]!.id;
  const raw = (await db.query<{ id: string }>(`INSERT INTO raw_content (user_id, content_type, content, processing_status) VALUES ($1, 'journal_entry', 'I walked to work', 'completed') RETURNING id`, [user])).rows[0]!.id;
  await db.query(`
    WITH f AS (
      INSERT INTO assertions (user_id, subject_entity_id, predicate, object_value, confidence, origin_key, assertion_kind)
      SELECT $1, $2, 'attended', jsonb_build_object('normalized', 'walk ' || g), 0.8, 'k' || g, 'observed' FROM generate_series(1, 2500) g
      RETURNING id)
    INSERT INTO assertion_evidence (assertion_id, user_id, raw_content_id, evidence_role, excerpt)
    SELECT f.id, $1, $3, 'supports', 'I walked to work' FROM f`, [user, self, raw]);
  const report = await runLint({ userId: user });
  const f2 = [...report.findings, ...report.safety].filter((f) => f.checkId === 'F2');
  assert.equal(f2.length, 0, `false "no evidence" finding: ${f2[0]?.detail}`);
});

test('a finding that stops occurring is resolved, comes back open, and a false positive stays closed', async () => {
  const user = await insertUser(db);
  const f = { checkId: 'P3', severity: 'bug' as const, subjectKind: 'behavior_pattern', subjectIds: [], fingerprint: 'fp-1', prevents: 'x', remediation: 'y' };
  const report = (findings: typeof f[]) => ({ userId: user, ranAt: new Date().toISOString(), findings, safety: [], counts: {} }) as unknown as Parameters<typeof persistFindings>[0];
  const state = async () => (await db.query<{ resolution: string }>(`SELECT resolution FROM lint_findings WHERE user_id = $1 AND fingerprint = 'fp-1'`, [user])).rows[0]!.resolution;

  await persistFindings(report([f]));
  assert.equal(await state(), 'open');
  assert.deepEqual(await persistFindings(report([])), { opened: 0, resolved: 1 });
  assert.equal(await state(), 'resolved');
  await persistFindings(report([f]));
  assert.equal(await state(), 'open', 'it came back');
  await db.query(`UPDATE lint_findings SET resolution = 'false_positive' WHERE user_id = $1`, [user]);
  await persistFindings(report([f]));
  assert.equal(await state(), 'false_positive', 'a person said it was wrong; lint does not overrule them');
});

test('H1 and H2: a guess asked twice without an answer, and one nothing has supported for 60 days, are flagged', async () => {
  const user = await insertUser(db);
  const one = async (sql: string, p: unknown[]) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;
  const pat = await one(`INSERT INTO behavior_patterns (user_id, slug, label, grouping_key, status, instance_count) VALUES ($1, 'says-yes', 'Says yes', 'g', 'live', 4) RETURNING id`, [user]);
  const asked = await one(`INSERT INTO behavior_pattern_whys (user_id, pattern_id, mechanism, confidence, status) VALUES ($1, $2, 'avoidance', 0.4, 'provisional') RETURNING id`, [user, pat]);
  const old = await one(`INSERT INTO behavior_pattern_whys (user_id, pattern_id, mechanism, confidence, status) VALUES ($1, $2, 'ambivalence', 0.4, 'provisional') RETURNING id`, [user, pat]);
  await db.query(`ALTER TABLE behavior_pattern_whys DISABLE TRIGGER USER`);
  await db.query(`UPDATE behavior_pattern_whys SET updated_at = now() - interval '70 days', created_at = now() - interval '70 days' WHERE id = $1`, [old]);
  await db.query(`ALTER TABLE behavior_pattern_whys ENABLE TRIGGER USER`);
  for (let i = 0; i < 2; i++) {
    await db.query(`INSERT INTO podcast_episodes (user_id, title, status, outline, script) VALUES ($1, 'e', 'ready', $2, 's')`, [user, JSON.stringify({ planner: 'v2', plan: { items: [], reflection: { whyId: asked } } })]);
  }
  const report = await runLint({ userId: user });
  const all = [...report.findings, ...report.safety];
  assert.ok(all.some((f) => f.checkId === 'H1' && f.subjectIds.includes(asked)), 'asked twice, never answered');
  assert.ok(all.some((f) => f.checkId === 'H2' && f.subjectIds.includes(old)), 'no support for 60 days');
  assert.ok(!all.some((f) => f.checkId === 'H1' && f.subjectIds.includes(old)), 'never asked, so not H1');
});
