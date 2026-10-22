/**
 * BEA.2: the agent trusts whatever user id it is sent, so every route and
 * engine here must refuse another person's ids. Two users each; routes are
 * called over HTTP.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { feedbackRouter } from '../src/routes/feedback';
import { correctionsRouter } from '../src/routes/corrections';
import { walkEvidence } from '../src/brain/lineage';
import { factsAbout, lineage, pattern } from '../src/brain/pulls';

let db: PGlite;
let server: Server;
let base = '';
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const app = express();
  app.use(express.json());
  app.use('/feedback', feedbackRouter);
  app.use('/corrections', correctionsRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const key = () => Math.random().toString(36).slice(2);
const one = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

async function person() {
  const user = await insertUser(db);
  const self = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user]);
  const item = (c: string) => one(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', $2) RETURNING id`, [user, c]);
  const fact = (evidence: unknown[], object: string | null = null) => one(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify({
    user_id: user, subject_entity_id: self, predicate: 'skipped_or_avoided',
    ...(object ? { object_entity_id: object } : { object_value: { normalized: `standup-${key()}` } }),
    origin_key: `k-${key()}`, evidence })]);
  const patternOf = async (factIds: string[]) => {
    const id = await one(`INSERT INTO behavior_patterns (user_id, slug, label, grouping_key, status) VALUES ($1, $2, 'Skips standup', $3, 'live') RETURNING id`, [user, `p-${key()}`, `g-${key()}`]);
    for (const f of factIds) await db.query(`INSERT INTO behavior_pattern_facts (pattern_id, assertion_id, user_id) VALUES ($1, $2, $3)`, [id, f, user]);
    return id;
  };
  const episode = () => one(`INSERT INTO podcast_episodes (user_id, title, script, status) VALUES ($1, 'Test episode', 'Test script.', 'ready') RETURNING id`, [user]);
  return { user, self, item, fact, patternOf, episode };
}

test("a user can't read another user's episode feedback", async () => {
  const alice = await person(), bob = await person();
  const ep = await bob.episode();
  assert.equal((await call('POST', `/feedback/episodes/${ep}`, { userId: bob.user, text: 'test feedback' })).status, 200);
  const asAlice = await call('GET', `/feedback/episodes/${ep}?userId=${alice.user}`);
  assert.deepEqual(asAlice.body, { feedback: [] });
  const asBob = await call('GET', `/feedback/episodes/${ep}?userId=${bob.user}`);
  assert.equal((asBob.body.feedback as unknown[]).length, 1);
  assert.equal((await call('GET', `/feedback/episodes/${ep}`)).status, 400, 'no user id, no feedback');
});

test("feedback can't be attached to someone else's episode", async () => {
  const alice = await person(), bob = await person();
  const ep = await bob.episode();
  const res = await call('POST', `/feedback/episodes/${ep}`, { userId: alice.user, text: 'test feedback' });
  assert.equal(res.status, 404);
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM episode_feedback WHERE episode_id = $1`, [ep]);
  assert.equal(rows[0]!.n, 0);
});

test("confirming another user's claim is not found and retires nothing", async () => {
  const alice = await person(), bob = await person();
  const f = await bob.fact([{ raw_content_id: await bob.item('x'), excerpt: 'x' }]);
  const res = await call('POST', '/corrections/confirm', { userId: alice.user, kind: 'fact', id: f });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'not found' });
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM assertions WHERE id = $1`, [f]);
  assert.equal(rows[0]!.status, 'active');
  const rejections = await db.query<{ n: number }>(`SELECT count(*)::int n FROM claim_rejections WHERE source_id = $1`, [f]);
  assert.equal(rejections.rows[0]!.n, 0);
  // The owner still can.
  assert.equal((await call('POST', '/corrections/confirm', { userId: bob.user, kind: 'fact', id: f })).status, 200);
});

test("walking evidence from another user's claim returns nothing", async () => {
  const alice = await person(), bob = await person();
  const e = await bob.item('I skipped standup');
  const f = await bob.fact([{ raw_content_id: e, excerpt: 'I skipped standup' }]);
  const pat = await bob.patternOf([f]);
  assert.deepEqual(await walkEvidence(alice.user, { kind: 'pattern', id: pat }), { sources: [], steps: [] });
  assert.deepEqual((await walkEvidence(bob.user, { kind: 'pattern', id: pat })).sources, [{ kind: 'raw_content', id: e }]);
});

test('factsAbout refuses a non-UUID entity id', async () => {
  const p = await person();
  await assert.rejects(factsAbout({ userId: p.user, entityId: `${p.self},user_id.neq.${p.user}` }), /must be a UUID/);
  await assert.rejects(factsAbout({ userId: p.user, entityId: 'not-an-id' }), /must be a UUID/);
});

test('factsAbout finds facts on either side of an entity, for that user only', async () => {
  const alice = await person(), bob = await person();
  const aboutAlice = await alice.fact([{ raw_content_id: await alice.item('a'), excerpt: 'a' }]);
  const pointingAtAlice = await alice.fact([{ raw_content_id: await alice.item('b'), excerpt: 'b' }], alice.self);
  const ids = (await factsAbout({ userId: alice.user, entityId: alice.self })).map((f) => f.id).sort();
  assert.deepEqual(ids, [aboutAlice, pointingAtAlice].sort());
  assert.deepEqual(await factsAbout({ userId: bob.user, entityId: alice.self }), []);
});

test("pulls sub-queries only see the user's rows", async () => {
  const alice = await person(), bob = await person();
  const e = await bob.item('I skipped standup');
  const f = await bob.fact([{ raw_content_id: e, excerpt: 'I skipped standup' }]);
  const pat = await bob.patternOf([f]);
  await db.query(`INSERT INTO behavior_pattern_whys (pattern_id, user_id, mechanism, status, evidence_assertion_ids) VALUES ($1, $2, 'avoidance', 'live', ARRAY[$3::uuid])`, [pat, bob.user, f]);

  // Alice naming Bob's ids: the backward and forward chains stop at nothing of Bob's.
  const back = await lineage({ userId: alice.user, id: f, kind: 'assertion', direction: 'backward' });
  assert.equal(back.some((n) => n.kind === 'raw_content' && n.id === e), false);
  const fwd = await lineage({ userId: alice.user, id: e, kind: 'raw_content', direction: 'forward' });
  assert.equal(fwd.some((n) => n.id === f || n.id === pat), false);
  assert.equal(await pattern({ userId: alice.user, patternId: pat }), null);

  // Bob sees his own.
  const bobFwd = await lineage({ userId: bob.user, id: e, kind: 'raw_content', direction: 'forward' });
  assert.ok(bobFwd.some((n) => n.kind === 'pattern' && n.id === pat));
  const bobPattern = await pattern({ userId: bob.user, patternId: pat });
  assert.equal(bobPattern?.whys.length, 1);
});
