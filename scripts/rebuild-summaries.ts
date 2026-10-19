#!/usr/bin/env tsx
/**
 * `npm run summaries:rebuild -- --user <id> [--days 120]` -- rebuild one
 * person's daily summaries (W3.1). Prints counts per domain only.
 */
import 'dotenv/config';
import { parseArgs } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { rebuildDailySummaries } from '../src/brain/daily-summaries';

async function main() {
  const args = parseArgs();
  if (typeof args.user !== 'string') throw new Error('--user <id> is required');
  const days = Number(typeof args.days === 'string' ? args.days : 120);
  const r = await rebuildDailySummaries(args.user, days);
  const { data } = await supabase.from(Tables.DAILY_SUMMARIES).select('domain,items').eq('user_id', args.user);
  const by = (data ?? []).reduce<Record<string, { days: number; items: number }>>((t, d: { domain: string; items: number }) => {
    t[d.domain] = { days: (t[d.domain]?.days ?? 0) + 1, items: (t[d.domain]?.items ?? 0) + d.items };
    return t;
  }, {});
  console.log(`${r.rows} summaries over ${r.days} days`);
  console.table(by);
}

main().catch((e) => { console.error(e); process.exit(1); });
