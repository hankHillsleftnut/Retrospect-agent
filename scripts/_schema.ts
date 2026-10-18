/**
 * Shared by db:check and migrate: what each migration adds, and whether
 * production has it. See src/health/schema-diff.ts for the judgement.
 */
import { freshDatabase, type PGlite, type MigrationResult } from '../tests/support/fresh-database';
import {
  SCHEMA_ITEMS_SQL, drift, itemsFromOpenApi, signatureOf, verdictFor,
  type MigrationSignature, type MigrationVerdict, type SchemaItems,
} from '../src/health/schema-diff';

export async function itemsOf(db: PGlite): Promise<SchemaItems> {
  const { rows } = await db.query<{ item: string }>(SCHEMA_ITEMS_SQL);
  return new Set(rows.map((r) => r.item));
}

export async function productionItems(): Promise<SchemaItems> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  });
  if (!res.ok) throw new Error(`could not read production's schema: HTTP ${res.status}`);
  return itemsFromOpenApi((await res.json()) as Parameters<typeof itemsFromOpenApi>[0]);
}


export async function compareWithProduction(): Promise<{
  verdicts: MigrationVerdict[];
  failedLocally: MigrationResult[];
  inCodeNotProduction: string[];
  inProductionNotCode: string[];
}> {
  const snapshots: { file: string; items: SchemaItems }[] = [];
  const { db, results } = await freshDatabase({
    onApplied: async (file, db) => { snapshots.push({ file, items: await itemsOf(db) }); },
  });
  const final = await itemsOf(db);
  const signatures: MigrationSignature[] = snapshots.map((s, i) =>
    signatureOf(s.file, i === 0 ? new Set() : snapshots[i - 1]!.items, s.items, final));
  const production = await productionItems();
  return {
    verdicts: signatures.map((s) => verdictFor(s, production)),
    failedLocally: results.filter((r) => !r.ok),
    ...drift(final, production),
  };
}
