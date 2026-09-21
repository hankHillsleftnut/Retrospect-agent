#!/usr/bin/env tsx
import { parseArgs, requireArg, optBool, optNum, optStr } from './_args';
import { writeOutput } from './_io';
import { runIngest } from '../src/pipelines/ingest';

async function main() {
  const args = parseArgs();
  const userId = requireArg(args, 'user');
  const daysBack = optNum(args, 'days') ?? 7;
  const dryRun = optBool(args, 'dry-run');
  const notes = optStr(args, 'notes');

  console.log(`[ingest] user=${userId} daysBack=${daysBack} dryRun=${dryRun}`);

  const result = await runIngest({
    userId,
    daysBack,
    dryRun,
    triggeredBy: 'cli',
    notes,
  });

  const out = writeOutput('ingest.json', result);
  // Facts first. They are what the product now rests on -- a span-verified
  // claim with the words that prove it. Observations and insights are the older
  // layer kept alive for surfaces that have not moved across yet, and reporting
  // them as the headline made a run look successful when the fact bank had
  // gained nothing at all.
  console.log(`\nresult:`);
  console.log(`  facts written:           ${result.facts_written ?? 0}`);
  console.log(`  facts dropped (no span): ${result.facts_dropped ?? 0}`);
  console.log(`  raw content processed:   ${result.raw_content_processed}`);
  console.log(`  --- legacy shim ---`);
  console.log(`  observations created:    ${result.observations_created}`);
  console.log(`  insights created:        ${result.insights_created}`);
  console.log(`  goal candidates created: ${result.goal_candidates_created}`);
  console.log(`  trace:                   ${result.traceId ?? '(dry-run)'}`);
  console.log(`  output saved:            ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
