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
import { compareWithProduction } from './_schema';

async function main() {
  const args = parseArgs();
  const { verdicts, failedLocally: failed, inCodeNotProduction, inProductionNotCode } = await compareWithProduction();

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
