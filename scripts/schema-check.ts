#!/usr/bin/env tsx
/**
 * `npm run db:check` -- which migrations does production actually have?
 *
 *   npm run db:check           per-migration verdict, plus drift
 *   npm run db:check -- --json machine-readable
 *
 * Read-only. Replays the migrations locally (in-process Postgres) to learn
 * what each one adds, then reads production's API description and looks for
 * those exact tables, columns and functions. Changes nothing anywhere.
 *
 * The judgement lives in src/health/schema-diff.ts, where it is tested.
 */
import 'dotenv/config';
import { parseArgs } from './_args';
import { freshDatabase, type PGlite } from '../tests/support/fresh-database';
import {
  SCHEMA_ITEMS_SQL, drift, itemsFromOpenApi, signatureOf, verdictFor,
  type MigrationSignature, type SchemaItems,
} from '../src/health/schema-diff';

async function itemsOf(db: PGlite): Promise<SchemaItems> {
  const { rows } = await db.query<{ item: string }>(SCHEMA_ITEMS_SQL);
  return new Set(rows.map((r) => r.item));
}

async function productionItems(): Promise<SchemaItems> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  });
  if (!res.ok) throw new Error(`could not read production's schema: HTTP ${res.status}`);
  return itemsFromOpenApi((await res.json()) as Parameters<typeof itemsFromOpenApi>[0]);
}

async function main() {
  const args = parseArgs();
  const snapshots: { file: string; items: SchemaItems }[] = [];
  const { db, results } = await freshDatabase({
    onApplied: async (file, db) => { snapshots.push({ file, items: await itemsOf(db) }); },
  });
  const failed = results.filter((r) => !r.ok);
  const final = await itemsOf(db);

  const signatures: MigrationSignature[] = snapshots.map((s, i) =>
    signatureOf(s.file, i === 0 ? new Set() : snapshots[i - 1]!.items, s.items, final));
  const production = await productionItems();
  const verdicts = signatures.map((s) => verdictFor(s, production));
  const { inCodeNotProduction, inProductionNotCode } = drift(final, production);

  if (args.json) {
    console.log(JSON.stringify({ verdicts, failedLocally: failed, inCodeNotProduction, inProductionNotCode }, null, 2));
    return;
  }

  const label = { applied: 'applied', not_applied: 'NOT APPLIED', partial: 'PARTLY APPLIED', cannot_tell: "can't tell" };
  console.log('\nMigration                                          Production');
  for (const v of verdicts) {
    console.log(`${v.file.padEnd(50)} ${label[v.status]}`);
    if (v.status === 'not_applied' || v.status === 'partial') {
      for (const m of v.missing.slice(0, 6)) console.log(`    missing ${m}`);
      if (v.missing.length > 6) console.log(`    ...and ${v.missing.length - 6} more`);
      for (const u of v.unexpected.slice(0, 6)) console.log(`    still present ${u}`);
    }
  }
  if (failed.length) console.log(`\n${failed.length} migration(s) did not replay locally: ${failed.map((f) => f.file).join(', ')}`);
  console.log(`\n"can't tell" = the migration only changes constraints, indexes, triggers, grants or data, which the API does not show.`);
  console.log(`\nIn production but not in any migration (${inProductionNotCode.length}):`);
  for (const i of inProductionNotCode.slice(0, 30)) console.log(`    ${i}`);
  if (inProductionNotCode.length > 30) console.log(`    ...and ${inProductionNotCode.length - 30} more`);
}

main().catch((err) => { console.error(err); process.exit(1); });
