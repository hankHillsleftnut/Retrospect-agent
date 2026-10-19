/**
 * The old framework's writes, against a real database. Only the paths that make
 * no embedding call are exercised here; the embedding paths need OpenAI.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { Trace } from '../src/pipelines/trace';
import { writeLegacyOutputs } from '../src/pipelines/legacy-writes';
import type { DbRawContent, IngestionResult } from '../src/types';

let db: PGlite;

before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

const empty = (): IngestionResult => ({ observations: [], insights: [], goal_candidates: [], identity_inferences: [] });
const batch = [{ id: 'not-read', content: 'x' } as DbRawContent];

test('a facts-only reply writes nothing to the old tables', async () => {
  const userId = await insertUser(db);
  const out = await writeLegacyOutputs({
    userId, batch, result: empty(), knownGoalIds: new Set(), trace: Trace.memoryOnly(),
  });
  assert.deepEqual(out, { observationIds: [], inferenceIds: [], insightsCreated: 0, candidatesCreated: 0, notes: [] });
});

test('an insight citing a goal the model was never shown is dropped, with a note', async () => {
  const userId = await insertUser(db);
  const result = empty();
  result.insights.push({
    title: 't', content: 'c', evidence_summary: 'e', confidence_score: 0.5,
    goal_id: '00000000-0000-0000-0000-000000000000', supporting_observation_indexes: [],
  });
  const out = await writeLegacyOutputs({ userId, batch, result, knownGoalIds: new Set(), trace: Trace.memoryOnly() });
  assert.equal(out.insightsCreated, 0);
  assert.deepEqual(out.notes, ['legacy insights dropped (goal not among those shown): 1']);
});

test('goal candidates are stored as pending for this user', async () => {
  const userId = await insertUser(db);
  const result = empty();
  result.goal_candidates.push({
    title: 'Run a marathon', description: 'd', reasoning: 'r', confidence_score: 0.6, supporting_observation_indexes: [],
  });
  const out = await writeLegacyOutputs({ userId, batch, result, knownGoalIds: new Set(), trace: Trace.memoryOnly() });
  assert.equal(out.candidatesCreated, 1);
  const { rows } = await db.query<{ title: string; status: string }>(
    `SELECT title, status FROM goal_candidates WHERE user_id = $1`, [userId]);
  assert.deepEqual(rows, [{ title: 'Run a marathon', status: 'pending' }]);
});
