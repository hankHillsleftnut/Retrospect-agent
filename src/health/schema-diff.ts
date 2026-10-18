/**
 * Which migrations production actually has.
 *
 * Every migration in this project is applied by hand, and production has
 * drifted from the code more than once. Instead of anyone remembering what was
 * run, this compares what each migration adds -- learned by replaying them one
 * at a time in a local Postgres -- with what production exposes.
 *
 * Pure comparison only; scripts/schema-check.ts gathers the two sides.
 *
 * What it can see: tables, views, their columns, and callable functions.
 * What it cannot: constraints, indexes, triggers, grants, and data. A
 * migration that only adds those is reported as "can't tell", never guessed.
 */

/** A schema as a set of items: "relation:x", "column:x.y", "function:f". */
export type SchemaItems = Set<string>;

export interface MigrationSignature {
  file: string;
  /** Items this migration adds that still exist after every later migration. */
  adds: string[];
  /** Items this migration removes that no later migration brings back. */
  removes: string[];
}

export type MigrationVerdict =
  | { file: string; status: 'applied' }
  | { file: string; status: 'not_applied' | 'partial'; missing: string[]; unexpected: string[] }
  | { file: string; status: 'cannot_tell' };

/** What one migration changed, from the schema just before and just after it. */
export function signatureOf(file: string, before: SchemaItems, after: SchemaItems, final: SchemaItems): MigrationSignature {
  return {
    file,
    adds: [...after].filter((i) => !before.has(i) && final.has(i)).sort(),
    removes: [...before].filter((i) => !after.has(i) && !final.has(i)).sort(),
  };
}

export function verdictFor(sig: MigrationSignature, production: SchemaItems): MigrationVerdict {
  const total = sig.adds.length + sig.removes.length;
  if (total === 0) return { file: sig.file, status: 'cannot_tell' };
  const missing = sig.adds.filter((i) => !production.has(i));
  const unexpected = sig.removes.filter((i) => production.has(i));
  const unmet = missing.length + unexpected.length;
  if (unmet === 0) return { file: sig.file, status: 'applied' };
  return { file: sig.file, status: unmet === total ? 'not_applied' : 'partial', missing, unexpected };
}

/**
 * Production items the code does not know about, and code items production
 * lacks. Functions are left out of "extra": Supabase and extensions add many
 * the migrations never mention.
 */
export function drift(expected: SchemaItems, production: SchemaItems): { inCodeNotProduction: string[]; inProductionNotCode: string[] } {
  return {
    inCodeNotProduction: [...expected].filter((i) => !production.has(i)).sort(),
    inProductionNotCode: [...production].filter((i) => !expected.has(i) && !i.startsWith('function:')).sort(),
  };
}

/** Production's side, from the PostgREST OpenAPI description. */
export function itemsFromOpenApi(spec: { definitions?: Record<string, { properties?: Record<string, unknown> }>; paths?: Record<string, unknown> }): SchemaItems {
  const items: SchemaItems = new Set();
  for (const [name, def] of Object.entries(spec.definitions ?? {})) {
    items.add(`relation:${name}`);
    for (const column of Object.keys(def.properties ?? {})) items.add(`column:${name}.${column}`);
  }
  for (const path of Object.keys(spec.paths ?? {})) {
    if (path.startsWith('/rpc/')) items.add(`function:${path.slice(5)}`);
  }
  return items;
}

/** The SQL that reads the same items from a Postgres database. */
export const SCHEMA_ITEMS_SQL = `
  SELECT 'relation:' || table_name AS item FROM information_schema.tables WHERE table_schema = 'public'
  UNION
  SELECT 'column:' || table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public'
  UNION
  -- Callable functions only: not trigger functions, not ones an extension owns.
  SELECT 'function:' || p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE p.prorettype <> 'trigger'::regtype
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
`;
