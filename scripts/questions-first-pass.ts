#!/usr/bin/env tsx
/**
 * `npm run questions:first-pass` -- make a best guess at all 36 questions for one person.
 *
 *   npm run questions:first-pass -- --user <id> --dry-run   show the guesses, save nothing
 *   npm run questions:first-pass -- --user <id>             save them
 *
 * Calls the model once per domain (eight calls). Prints the cost.
 * Needs migrations 120 and 121.
 */
import 'dotenv/config';
import { parseArgs, requireArg } from './_args';
import { runFirstPass } from '../src/questions/run-first-pass';
import { formatCostLines } from '../src/pipelines/trace';

async function main() {
  const args = parseArgs();
  const userId = requireArg(args, 'user');
  const dryRun = args['dry-run'] === true;

  const report = await runFirstPass(userId, { dryRun });

  console.log(`\n${dryRun ? 'DRY RUN -- nothing saved' : 'Saved'} · ${report.poolSize} items on record · $${report.costUsd.toFixed(2)}\n`);
  for (const o of report.outcomes) {
    const line = o.status === 'guessed'
      ? `${o.guess.answer}\n      rests on ${o.guess.evidence.length} item(s)${o.guess.evidence.filter((e) => e.excerpt).map((e) => `\n      "${e.excerpt}"`).join('')}`
      : o.status.replace('_', ' ');
    console.log(`Q${String(o.questionId).padStart(2)}  ${line}`);
    for (const d of o.dropped) console.log(`      dropped ${d.handle}: ${d.reason.replace(/_/g, ' ')}`);
  }
  console.log(`\n${JSON.stringify(report.byStatus)}`);
  if (!dryRun) console.log(`recorded ${report.recorded} of ${report.guessed}`);
  for (const r of report.refusedByDatabase) console.log(`refused Q${r.questionId}: ${r.reason}`);
  console.log(`\nCost:\n${formatCostLines(report.cost, Object.fromEntries(report.cost.map((l) => [l.model, 'guessing answers, one call per part of life'])))}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
