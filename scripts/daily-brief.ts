#!/usr/bin/env tsx
/**
 * `npm run brief -- --user <id> [--dry-run]` -- make one person's daily brief now
 * and print it. --dry-run saves nothing.
 */
import 'dotenv/config';
import { parseArgs, requireArg } from './_args';
import { runDailyBrief } from '../src/briefs/run-daily-brief';
import { formatCostLines } from '../src/pipelines/trace';

async function main() {
  const args = parseArgs();
  const r = await runDailyBrief(requireArg(args, 'user'), { dryRun: args['dry-run'] === true });
  const b = r.brief;
  console.log(`\n${r.briefDate} · ${b.kind.toUpperCase()} · read ${r.materialCount} new item(s) · ${r.saved ? 'saved' : 'not saved (dry run)'}\n`);
  console.log(`Through-line: ${b.throughLine}${b.spineQuestionId ? `  [spine Q${b.spineQuestionId}, ${b.spineMovement}]` : ''}\n`);
  b.items.forEach((i, n) => console.log(`${n + 1}. ${i.text}\n   why: ${i.why ?? '(aside)'}\n   "${i.quote}"\n`));
  if (b.dropped) console.log(`Dropped ${b.dropped} item(s) whose quote wasn't in the material.`);
  console.log(`\nCost:\n${formatCostLines(r.cost, Object.fromEntries(r.cost.map((l) => [l.model, 'writing the daily brief'])))}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
