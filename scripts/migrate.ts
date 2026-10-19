#!/usr/bin/env tsx
/**
 * `npm run db:migrate` -- apply pending migrations, instead of pasting SQL by hand.
 *
 *   npm run db:migrate                                       show the plan; change nothing
 *   npm run db:migrate -- --apply                            apply it
 *   npm run db:migrate -- --baseline-through 114_x.sql       first run only: record 100..114
 *                                                            as already applied, without running them
 *
 * Needs DATABASE_URL: the direct Postgres connection string (Supabase
 * dashboard -> Project Settings -> Database). The API keys cannot change
 * table structure. Keep it in .env only; it is never printed.
 *
 * Safety:
 *   - Nothing changes without --apply.
 *   - Each migration runs in its own transaction and is recorded in
 *     schema_migrations; a failure rolls back that migration and stops.
 *   - Before applying, production is compared with what each pending migration
 *     adds (the db:check comparison). A migration that production already has,
 *     fully or partly, is refused -- it was applied by hand and should be
 *     baselined, not run twice.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { parseArgs } from './_args';
import { compareWithProduction } from './_schema';
import { migrationFiles } from '../tests/support/fresh-database';
import { applyPlan, plan, recordedMigrations } from '../src/db/migrate';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');

async function main() {
  const args = parseArgs();
  const apply = args.apply === true;
  const baseline = typeof args['baseline-through'] === 'string' ? args['baseline-through'] : undefined;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Add the direct Postgres connection string to .env (never commit it).');
    process.exit(1);
  }

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log(`Database: ${new URL(url).hostname}`);
    // A preview only reads; the ledger table is created only when applying.
    const p = plan(migrationFiles(), await recordedMigrations(client, { create: apply }), baseline);

    console.log(`\nAlready recorded: ${p.alreadyRecorded.length}`);
    if (p.toBaseline.length) console.log(`Record as already applied (not run): ${p.toBaseline.join(', ')}`);
    console.log(`To apply: ${p.toApply.length ? p.toApply.join(', ') : 'nothing'}`);
    if (p.toApply.length === 0 && p.toBaseline.length === 0) return;

    // Refuse to re-run anything production already has.
    const { verdicts } = await compareWithProduction();
    const present = verdicts.filter((v) => p.toApply.includes(v.file) && (v.status === 'applied' || v.status === 'partial'));
    if (present.length) {
      console.error(`\nRefusing: production already has ${present.map((v) => `${v.file} (${v.status})`).join(', ')}.`);
      console.error('These were applied by hand. Baseline through the last of them instead of running them again.');
      process.exit(1);
    }

    if (!apply) {
      console.log('\nPlan only. Re-run with --apply to carry it out.');
      return;
    }
    const result = await applyPlan(client, p, (f) => readFileSync(join(MIGRATIONS, f), 'utf8'));
    if (result.baselined.length) console.log(`\nRecorded as already applied: ${result.baselined.join(', ')}`);
    if (result.applied.length) console.log(`Applied: ${result.applied.join(', ')}`);
    if (result.failed) {
      console.error(`\nFAILED: ${result.failed.file}: ${result.failed.error}\nRolled back; nothing after it ran.`);
      process.exit(1);
    }
    console.log('\nDone. `npm run db:check` should now show these as applied.');
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
