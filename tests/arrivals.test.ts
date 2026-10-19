/** F3.2: new material is read, then researched, once the person has gone quiet. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { handleArrivals, claimFromDb, finishInDb, type ArrivalDeps, type Claim } from '../src/events/arrivals';

const claim = (user_id: string): Claim => ({ user_id, claimed_at: '2026-10-19T00:00:00Z', arrivals: 1 });

function fakes(over: Partial<ArrivalDeps> = {}) {
  const calls: string[] = [];
  const deps: ArrivalDeps = {
    claim: async () => [claim('a'), claim('b')],
    finish: async (c, ok) => { calls.push(`finish ${c.user_id} ${ok}`); return ok ? 'done' : 'released'; },
    mayRun: async () => true,
    read: async (u) => { calls.push(`read ${u}`); },
    research: async (u) => { calls.push(`research ${u}`); },
    ...over,
  };
  return { deps, calls };
}

test('each claimed person is read, then researched, then the event is spent', async () => {
  const { deps, calls } = fakes();
  const r = await handleArrivals(deps);
  assert.deepEqual(calls, ['read a', 'research a', 'finish a true', 'read b', 'research b', 'finish b true']);
  assert.deepEqual(r.map((x) => x.outcome), ['done', 'done']);
});

test('a failure for one person releases their claim and does not stop the others', async () => {
  const { deps, calls } = fakes({ read: async (u) => { calls.push(`read ${u}`); if (u === 'a') throw new Error('boom'); } });
  const r = await handleArrivals(deps);
  assert.deepEqual(r, [{ userId: 'a', outcome: 'released', error: 'boom' }, { userId: 'b', outcome: 'done' }]);
  assert.ok(!calls.includes('research a'), 'no research on unread material');
});

test('over the daily spend cap: nothing runs, and the claim is left to lapse', async () => {
  const { deps, calls } = fakes({ mayRun: async (u) => u !== 'a' });
  const r = await handleArrivals(deps);
  assert.equal(r[0]!.outcome, 'deferred');
  assert.ok(!calls.some((c) => c.endsWith(' a') || c.includes(' a ')));
});

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('against the database: an upload is claimed once settled and spent when done', async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'x'), ($1, 'journal_entry', 'y')`, [user]);
  assert.ok(!(await claimFromDb()).some((c) => c.user_id === user), 'still settling');
  await db.query(`UPDATE material_arrivals SET last_arrival_at = now() - interval '3 minutes' WHERE user_id = $1`, [user]);
  const mine = (await claimFromDb()).filter((c) => c.user_id === user);
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.arrivals, 2);
  assert.equal(await finishInDb(mine[0]!, true), 'done');
  assert.equal((await db.query(`SELECT 1 FROM material_arrivals WHERE user_id = $1`, [user])).rows.length, 0);
});

test('133: a run can record that an event started it', async () => {
  const user = await insertUser(db);
  await db.query(`INSERT INTO pipeline_run_traces (user_id, kind, triggered_by) VALUES ($1, 'ingest', 'event')`, [user]);
});
