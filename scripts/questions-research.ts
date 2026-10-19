#!/usr/bin/env tsx
/**
 * `npm run questions:research -- --user <id>` -- one run of the ambient researcher.
 *
 * The same work the daily job does (src/jobs/question-research.ts), for one
 * person, on demand. Saves through record_answer and logs every look.
 */
import 'dotenv/config';
import { parseArgs, requireArg } from './_args';
import { runResearch } from '../src/questions/run-research';

async function main() {
  const userId = requireArg(parseArgs(), 'user');
  const { researched, costUsd } = await runResearch(userId);
  for (const r of researched) {
    console.log(`Q${String(r.questionId).padStart(2)}  ${r.outcome.padEnd(13)} read ${r.itemsRead} new item(s)${r.detail ? `  -- ${r.detail.slice(0, 160)}` : ''}`);
  }
  console.log(`\nCost $${costUsd.toFixed(3)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
