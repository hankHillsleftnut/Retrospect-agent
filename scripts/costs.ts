#!/usr/bin/env tsx
/**
 * `npm run costs -- [--hours 24] [--user <id>]` -- what each person has cost,
 * by kind of work, over a window. Read-only. Reads what runs already record.
 */
import 'dotenv/config';
import { parseArgs } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { spendSince, DAILY_SPEND_CAP_USD } from '../src/pipelines/spend-guard';

async function main() {
  const args = parseArgs();
  const hours = Number(typeof args.hours === 'string' ? args.hours : 24);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  let users: string[];
  if (typeof args.user === 'string') users = [args.user];
  else {
    const { data } = await supabase.from(Tables.PIPELINE_RUN_TRACES).select('user_id').gte('started_at', since);
    users = [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))];
  }
  console.log(`Spend in the last ${hours}h (ceiling $${DAILY_SPEND_CAP_USD} per person per 24h${DAILY_SPEND_CAP_USD === 0 ? ', off' : ''})\n`);
  let total = 0;
  for (const userId of users) {
    const s = await spendSince(userId, since);
    total += s.totalUsd;
    const parts = Object.entries(s.byKind).map(([k, v]) => `${k} $${v.toFixed(2)}`).join(' · ');
    console.log(`${userId}  $${s.totalUsd.toFixed(2)}  ${parts}`);
  }
  console.log(`\nTotal $${total.toFixed(2)} across ${users.length} person(s).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
