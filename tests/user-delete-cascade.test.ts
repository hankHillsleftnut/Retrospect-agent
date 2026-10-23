import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freshDatabase, insertUser, type PGlite } from './support/fresh-database';
import { Tables } from '../src/db/tables';

/**
 * BE0.6: the brain deletes no row when an account is deleted. The backend
 * deletes the `users` row, and everything a person has must go with it. This
 * proves it on a database built from every migration:
 *  1. every table in src/db/tables.ts that holds a person's data reaches
 *     `users` through foreign keys that all say ON DELETE CASCADE;
 *  2. with two people, a row in every such table each, deleting one person
 *     empties every one of their rows and leaves every one of the other's.
 *
 * The exceptions, and why (listed in the PR):
 */
const SHARED = new Set([
  // The question bank and its vocabulary: the same for everyone, no person in them.
  'question_domains', 'canonical_questions', 'evidence_kinds',
]);
const VIEWS = new Set([
  // Views over person tables: they hold nothing of their own.
  'answer_confidence', 'current_answers', 'domain_coverage', 'claim_edges',
]);

interface Fk { child: string; parent: string; cols: string[]; refCols: string[]; cascade: boolean }
interface Col { name: string; type: string; udt: string; nullable: boolean; hasDefault: boolean; generated: boolean; formatted: string }

let db: PGlite;
let fks: Fk[] = [];
let baseTables = new Set<string>();
before(async () => {
  ({ db } = await freshDatabase());
  const { rows } = await db.query<{ child: string; parent: string; cols: string[]; refcols: string[]; del: string }>(`
    SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent, c.confdeltype AS del,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n, i) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.i) AS cols,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n, i) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.i) AS refcols
    FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`);
  fks = rows.map((r) => ({ child: r.child, parent: r.parent, cols: r.cols, refCols: r.refcols, cascade: r.del === 'c' }));
  const t = await db.query<{ relname: string }>(`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')`);
  baseTables = new Set(t.rows.map((r) => r.relname));
});

/** Tables whose rows go when a user does: a chain of ON DELETE CASCADE keys up to `users`. */
function cascadesFromUsers(): Set<string> {
  const reached = new Set<string>(['users']);
  for (let grew = true; grew;) {
    grew = false;
    for (const fk of fks) {
      if (fk.cascade && reached.has(fk.parent) && !reached.has(fk.child)) { reached.add(fk.child); grew = true; }
    }
  }
  reached.delete('users');
  return reached;
}

/** Every table that holds a person's data: the named ones (less the exceptions), and any base table with a user_id. */
async function personTables(): Promise<string[]> {
  const named = Object.values(Tables).filter((t) => t !== 'users' && !SHARED.has(t) && !VIEWS.has(t));
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
     WHERE c.table_schema = 'public' AND c.column_name = 'user_id' AND t.table_type = 'BASE TABLE'`);
  return [...new Set([...named, ...rows.map((r) => r.table_name)])].sort();
}

test('the exceptions are what they say: shared tables name no person, views are views', async () => {
  for (const t of SHARED) {
    assert.ok(baseTables.has(t), `${t} is a table`);
    const { rows } = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'user_id'`, [t]);
    assert.equal(rows.length, 0, `${t} has a user_id: it holds a person's data`);
    assert.equal(fks.some((f) => f.child === t && f.parent === 'users'), false, `${t} points at users`);
  }
  for (const v of VIEWS) {
    const { rows } = await db.query<{ relkind: string }>(`SELECT relkind FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace`, [v]);
    assert.equal(rows[0]?.relkind, 'v', `${v} is a view`);
  }
});

test('every table that holds a person\'s data reaches users by ON DELETE CASCADE', async () => {
  const reached = cascadesFromUsers();
  const missing = (await personTables()).filter((t) => !reached.has(t));
  assert.deepEqual(missing, [], 'these keep a person\'s rows after their account is deleted');
  // A user_id that points at users must cascade itself, not only through a parent.
  const weak = fks.filter((f) => f.parent === 'users' && !f.cascade).map((f) => `${f.child}.${f.cols.join(',')}`);
  assert.deepEqual(weak, [], 'a key to users that does not cascade blocks or orphans the delete');
});

// ── Two people, a row each in every table ──────────────────────────────────────

const columnsCache = new Map<string, Col[]>();
async function columnsOf(table: string): Promise<Col[]> {
  if (!columnsCache.has(table)) {
    const { rows } = await db.query<{ name: string; type: string; udt: string; nullable: boolean; has_default: boolean; generated: boolean; formatted: string }>(`
      SELECT a.attname AS name, c.data_type AS type, c.udt_name AS udt, NOT a.attnotnull AS nullable,
        (a.atthasdef OR c.is_identity = 'YES') AS has_default, (a.attgenerated <> '') AS generated,
        format_type(a.atttypid, a.atttypmod) AS formatted
      FROM pg_attribute a JOIN information_schema.columns c ON c.table_schema = 'public' AND c.table_name = $1 AND c.column_name = a.attname
      WHERE a.attrelid = ('public.' || $1)::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [table]);
    columnsCache.set(table, rows.map((r) => ({ name: r.name, type: r.type, udt: r.udt, nullable: r.nullable, hasDefault: r.has_default, generated: r.generated, formatted: r.formatted })));
  }
  return columnsCache.get(table)!;
}

/** The first literal a CHECK constraint allows for this column, if one names it. */
async function checkLiteral(table: string, column: string): Promise<string | null> {
  const { rows } = await db.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = ('public.' || $1)::regclass AND contype = 'c'`, [table]);
  for (const { def } of rows) {
    if (!new RegExp(`\\b${column}\\b`).test(def)) continue;
    const m = /'([^']*)'::(?:text|character varying)/.exec(def);
    if (m) return m[1]!;
  }
  return null;
}

/** A value of the right type for a NOT NULL column with no default. */
async function valueFor(table: string, col: Col): Promise<unknown> {
  const literal = await checkLiteral(table, col.name);
  switch (col.type) {
    case 'uuid': return randomUUID();
    case 'text': case 'character varying': case 'character': return literal ?? `v-${randomUUID().slice(0, 8)}`;
    case 'integer': case 'bigint': case 'smallint': case 'numeric': case 'real': case 'double precision': return 1;
    case 'boolean': return true;
    case 'json': case 'jsonb': return literal === 'array' ? '[]' : '{}';
    case 'timestamp with time zone': case 'timestamp without time zone': return new Date('2026-10-20T10:00:00Z').toISOString();
    case 'date': return '2026-10-20';
    case 'interval': return '1 day';
    case 'ARRAY': return '{}';
    case 'USER-DEFINED': {
      const dim = /^vector\((\d+)\)$/.exec(col.formatted);
      if (dim) return `[${new Array(Number(dim[1])).fill(0).join(',')}]`;
      const { rows } = await db.query<{ label: string }>(
        `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`, [col.udt]);
      if (rows[0]) return rows[0].label;
      throw new Error(`no value for ${table}.${col.name} (${col.formatted})`);
    }
    default: throw new Error(`no value for ${table}.${col.name} (${col.type})`);
  }
}

type Seeded = Map<string, Record<string, unknown>>; // table -> the row's key columns
/** Second rows made for tables with two keys to one parent; checked like the rest. */
const extras: Array<{ owner: string; table: string; row: Record<string, unknown> }> = [];

/** Tables written only through a database function: seeded the way production writes them. */
const WRITTEN_BY_FUNCTION: Record<string, { needs: string[]; seed: (owner: string, seeded: Seeded) => Promise<Record<string, unknown>> }> = {
  question_answers: {
    needs: ['raw_content'],
    seed: async (owner, seeded) => {
      const { rows: [{ id }] } = await db.query<{ id: string }>(`SELECT record_answer($1::jsonb) AS id`, [JSON.stringify({
        user_id: owner, question_id: 30, answer: 'a', derived_by: 'first_pass', derivation_key: `d-${randomUUID()}`,
        evidence: [{ raw_content_id: seeded.get('raw_content')!.id, excerpt: 'x' }],
      })]) as unknown as { rows: [{ id: string }] };
      return (await db.query<Record<string, unknown>>(`SELECT * FROM question_answers WHERE id = $1`, [id])).rows[0]!;
    },
  },
  // record_answer writes the answer's evidence with it (exactly one kind of source per row).
  answer_evidence: {
    needs: ['question_answers'],
    seed: async (_owner, seeded) => (await db.query<Record<string, unknown>>(
      `SELECT * FROM answer_evidence WHERE answer_id = $1 LIMIT 1`, [seeded.get('question_answers')!.id])).rows[0]!,
  },
};

/** One row in `table` for this owner (or a shared row when owner is null), every NOT NULL key pointing at the owner's rows. */
async function seedRow(table: string, owner: string | null, seeded: Seeded, shared: Seeded): Promise<void> {
  const special = owner ? WRITTEN_BY_FUNCTION[table] : undefined;
  if (special) { seeded.set(table, await special.seed(owner!, seeded)); return; }
  const cols = await columnsOf(table);
  const values: Record<string, unknown> = {};
  const usedParents = new Set<string>();
  for (const fk of fks.filter((f) => f.child === table)) {
    const required = fk.cols.some((c) => !cols.find((x) => x.name === c)!.nullable);
    let parentRow = fk.parent === 'users' ? (owner ? { id: owner } : null) : (seeded.get(fk.parent) ?? shared.get(fk.parent));
    // A second key to the same table (left/right, from/to) gets a second row of it: they must differ.
    if (owner && required && parentRow && fk.parent !== 'users' && usedParents.has(fk.parent) && seeded.has(fk.parent)) {
      const second: Seeded = new Map(seeded);
      await seedRow(fk.parent, owner, second, shared);
      parentRow = second.get(fk.parent)!;
      extras.push({ owner, table: fk.parent, row: parentRow });
    }
    usedParents.add(fk.parent);
    if (!parentRow) {
      if (required) throw new Error(`${table} needs a ${fk.parent} row first`);
      continue;
    }
    // Optional keys to the owner's own rows are filled too, so every cascade path is walked.
    if (!required && fk.parent !== 'users' && !seeded.has(fk.parent)) continue;
    fk.cols.forEach((c, i) => { values[c] = parentRow[fk.refCols[i]!]; });
  }
  if (owner && cols.some((c) => c.name === 'user_id')) values.user_id = owner;
  for (const col of cols) {
    if (col.name in values || col.generated || col.nullable || col.hasDefault) continue;
    values[col.name] = await valueFor(table, col);
  }
  const names = Object.keys(values);
  try {
    const { rows } = await db.query<Record<string, unknown>>(
      `INSERT INTO ${table} (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      names.map((n) => values[n]),
    );
    (owner ? seeded : shared).set(table, rows[0]!);
  } catch (e) {
    // A trigger already wrote the owner's one row here (material_arrivals follows raw_content): use it.
    if ((e as { code?: string }).code !== '23505' || !owner || !('user_id' in values)) throw e;
    const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE user_id = $1 LIMIT 1`, [owner]);
    if (!rows[0]) throw e;
    seeded.set(table, rows[0]);
  }
}

/** Order tables so each comes after the tables its required keys point at. */
async function seedOrder(tables: string[]): Promise<string[]> {
  const ordered: string[] = [];
  const pending = new Set(tables);
  while (pending.size) {
    const before = pending.size;
    for (const t of [...pending]) {
      const cols = await columnsOf(t);
      const needs = fks.filter((f) => f.child === t && f.parent !== t && pending.has(f.parent)
        && f.cols.some((c) => !cols.find((x) => x.name === c)!.nullable));
      const special = (WRITTEN_BY_FUNCTION[t]?.needs ?? []).filter((p) => pending.has(p));
      if (needs.length === 0 && special.length === 0) { ordered.push(t); pending.delete(t); }
    }
    if (pending.size === before) throw new Error(`a cycle of required keys: ${[...pending].join(', ')}`);
  }
  return ordered;
}

async function keyOf(table: string): Promise<string[]> {
  const { rows } = await db.query<{ col: string }>(`
    SELECT a.attname AS col FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = ('public.' || $1)::regclass AND i.indisprimary`, [table]);
  return rows.map((r) => r.col);
}
async function stillThere(table: string, row: Record<string, unknown>): Promise<boolean> {
  const key = await keyOf(table);
  assert.ok(key.length > 0, `${table} has a primary key`);
  const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE ${key.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ')}`, key.map((k) => row[k]));
  return rows.length > 0;
}

test('deleting one person empties every one of their rows and leaves every one of the other person\'s', async () => {
  const people = new Set([...cascadesFromUsers(), ...(await personTables())]);
  const tables = [...people].filter((t) => baseTables.has(t));
  // Shared tables a person's rows point at (the question bank): one row, owned by nobody.
  const sharedParents = new Set(fks.filter((f) => people.has(f.child) && !people.has(f.parent) && f.parent !== 'users').map((f) => f.parent));
  for (let grew = true; grew;) {
    grew = false;
    for (const f of fks) {
      if (sharedParents.has(f.child) && f.parent !== f.child && f.parent !== 'users' && !sharedParents.has(f.parent)) { sharedParents.add(f.parent); grew = true; }
    }
  }
  const shared: Seeded = new Map();
  for (const t of await seedOrder([...sharedParents])) {
    // The migrations seed the question bank; use what is there.
    const existing = await db.query<Record<string, unknown>>(`SELECT * FROM ${t} LIMIT 1`);
    if (existing.rows[0]) shared.set(t, existing.rows[0]);
    else await seedRow(t, null, shared, shared);
  }

  const order = await seedOrder(tables);
  const alice = await insertUser(db);
  const bob = await insertUser(db);
  const rows = { [alice]: new Map() as Seeded, [bob]: new Map() as Seeded };
  for (const owner of [alice, bob]) {
    for (const t of order) {
      try {
        await seedRow(t, owner, rows[owner]!, shared);
      } catch (e) {
        throw new Error(`could not seed ${t}: ${String((e as Error).message).split('\n')[0]}`);
      }
    }
  }
  assert.equal(rows[alice]!.size, tables.length, 'a row in every table');
  // The tables this test must cover are all among those seeded.
  for (const t of await personTables()) assert.ok(rows[alice]!.has(t), `${t} was seeded`);

  await db.query('DELETE FROM users WHERE id = $1', [alice]);

  const kept: string[] = [];
  const lost: string[] = [];
  for (const t of order) {
    if (await stillThere(t, rows[alice]!.get(t)!)) kept.push(t);
    if (!(await stillThere(t, rows[bob]!.get(t)!))) lost.push(t);
  }
  for (const e of extras) {
    const there = await stillThere(e.table, e.row);
    if (e.owner === alice && there) kept.push(`${e.table} (second row)`);
    if (e.owner === bob && !there) lost.push(`${e.table} (second row)`);
  }
  assert.deepEqual(kept, [], 'the deleted person\'s rows that survived');
  assert.deepEqual(lost, [], 'the other person\'s rows that went with them');
  for (const [t, row] of shared) assert.ok(await stillThere(t, row), `shared ${t} is untouched`);
});
