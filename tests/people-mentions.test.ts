import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddress, resolveMention, type KnownPerson } from '../src/people/run-resolution';

test('addresses parse with and without a display name', () => {
  assert.deepEqual(parseAddress('Dana Reyes <Dana@Studio.example>'), { name: 'Dana Reyes', email: 'dana@studio.example' });
  assert.deepEqual(parseAddress('"Kim, Alex" <alex@x.com>'), { name: 'Kim, Alex', email: 'alex@x.com' });
  assert.deepEqual(parseAddress('sam@x.com'), { name: null, email: 'sam@x.com' });
});

const people: KnownPerson[] = [
  { id: 'priya', name: 'Priya', emails: [] },
  { id: 'samO', name: 'Sam Ortiz', emails: ['sam.o@example.com'] },
  { id: 'samL', name: 'Sam Lee', emails: [] },
];

test('a known email is known; a unique first name links; an ambiguous one is held; a stranger is new', () => {
  assert.equal(resolveMention({ name: 'S. Ortiz', email: 'sam.o@example.com' }, people).decision, 'known');
  assert.deepEqual([resolveMention({ name: 'Priya Raman', email: 'priya@example.com' }, people).decision, resolveMention({ name: 'Priya Raman', email: 'priya@example.com' }, people).personId], ['link', 'priya']);
  assert.equal(resolveMention({ name: 'Sam', email: null }, people).decision, 'hold');
  assert.equal(resolveMention({ name: 'Nina Park', email: 'nina@x.com' }, people).decision, 'separate');
});

test('a different person with a shared first name is never linked', () => {
  const o = resolveMention({ name: 'Sam Lee', email: 'samlee@example.com' }, [{ id: 'samO', name: 'Sam Ortiz', emails: ['sam.o@example.com'] }]);
  assert.notEqual(o.decision, 'link');
});

import { before } from 'node:test';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { supabaseOnPglite } from './support/supabase-on-pglite';
import { supabase } from '../src/db/supabase';
import { applyWritingToContacts } from '../src/people/run-resolution';

let db: PGlite;
before(async () => {
  ({ db } = await freshDatabase());
  const fake = supabaseOnPglite(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
});

test('W2.6, against the database: a link folds the written-about person into the contact; a hold only records the question', async () => {
  const user = await insertUser(db);
  const one = async (sql: string, p: unknown[]) => (await db.query<{ id: string }>(sql, p)).rows[0]!.id;
  const person = async (name: string, ns: string, alias: string) => {
    const id = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'person', $2) RETURNING id`, [user, name]);
    await db.query(`INSERT INTO entity_aliases (user_id, entity_id, namespace, alias) VALUES ($1, $2, $3, $4)`, [user, id, ns, alias]);
    return id;
  };
  const priyaW = await person('Priya', 'journal:name', 'priya');
  const priyaC = await person('Priya Raman', 'contacts', 'c1');
  const samW = await person('Sam', 'journal:name', 'sam');
  const samO = await person('Sam Ortiz', 'contacts', 'c2');
  await person('Sam Lee', 'contacts', 'c3');
  const self = await one(`INSERT INTO entities (user_id, entity_type, canonical_name) VALUES ($1, 'identity', 'Self') RETURNING id`, [user]);
  const entry = await one(`INSERT INTO raw_content (user_id, content_type, content) VALUES ($1, 'journal_entry', 'Climbed with Priya') RETURNING id`, [user]);
  const fact = await one(`SELECT write_fact($1::jsonb) AS id`, [JSON.stringify({ user_id: user, subject_entity_id: self, predicate: 'mentioned_person', object_value: { normalized: 'priya' }, object_entity_id: priyaW, origin_key: 'o1', evidence: [{ raw_content_id: entry, excerpt: 'Climbed with Priya' }] })]);

  const r = await applyWritingToContacts(user, supabase);
  assert.deepEqual(r, { linked: 1, held: 1, skipped: 0 });
  const q = async (sql: string, p: unknown[]) => (await db.query<Record<string, unknown>>(sql, p)).rows;
  assert.deepEqual(await q(`SELECT entity_id FROM entity_aliases WHERE alias = 'priya' AND user_id = $1`, [user]), [{ entity_id: priyaC }], 'the name now finds the contact');
  assert.equal((await q(`SELECT merged_into_id FROM entities WHERE id = $1`, [priyaW]))[0]!.merged_into_id, priyaC, 'old record kept, marked');
  const objectCol = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'assertions' AND column_name = 'object_entity_id'`, [])).length;
  if (objectCol) assert.equal((await q(`SELECT object_entity_id FROM assertions WHERE id = $1`, [fact]))[0]!.object_entity_id, priyaC);
  assert.deepEqual(await q(`SELECT status FROM entity_resolution_candidates WHERE left_entity_id = $1`, [samW]), [{ status: 'pending' }], 'Sam is asked about');
  assert.equal((await q(`SELECT merged_into_id FROM entities WHERE id = $1`, [samW]))[0]!.merged_into_id, null, 'nothing moved for a hold');
  assert.ok(samO);
  assert.deepEqual(await applyWritingToContacts(user, supabase), { linked: 0, held: 0, skipped: 1 }, 'safe to repeat');
});
