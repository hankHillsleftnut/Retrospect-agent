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
  console.log(`\nresult:`);
  console.log(`  observations created:    ${result.observations_created}`);
  console.log(`  insights created:        ${result.insights_created}`);
  console.log(`  goal candidates created: ${result.goal_candidates_created}`);
  console.log(`  raw content processed:   ${result.raw_content_processed}`);
  console.log(`  trace:                   ${result.traceId ?? '(dry-run)'}`);
  console.log(`  output saved:            ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
