#!/usr/bin/env tsx
/**
 * `npm run questions:research -- --user <id>` -- one run of the ambient researcher.
 *   --budget <n>             look at up to n questions (default 6)
 *   --reread-since <iso>     look again at everything since then (one-off)
 *
 * The same work the daily job does (src/jobs/question-research.ts), for one
 * person, on demand. Saves through record_answer and logs every look.
 */
import 'dotenv/config';
import { parseArgs, requireArg } from './_args';
import { runResearch } from '../src/questions/run-research';

async function main() {
  const args = parseArgs();
  const userId = requireArg(args, 'user');
  const { researched, costUsd } = await runResearch(userId, {
    ...(typeof args.budget === 'string' ? { budget: Number(args.budget) } : {}),
    ...(typeof args['reread-since'] === 'string' ? { rereadSince: args['reread-since'] } : {}),
  });
  for (const r of researched) {
    console.log(`Q${String(r.questionId).padStart(2)}  ${r.outcome.padEnd(13)} read ${r.itemsRead} new item(s)${r.detail ? `  -- ${r.detail.slice(0, 160)}` : ''}`);
  }
  console.log(`\nCost $${costUsd.toFixed(3)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
