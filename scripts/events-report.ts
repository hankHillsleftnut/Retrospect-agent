#!/usr/bin/env tsx
/**
 * `npm run events:report -- [--days 7]` -- F3.3. How fast new material is
 * read, and whether the event or a cron started the reading. Counts and
 * timings only; never content.
 */
import 'dotenv/config';
import { parseArgs } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { selectAll } from '../src/db/paged';
import { summariseLatency } from '../src/events/arrivals';

async function main() {
  const args = parseArgs();
  const days = Number(typeof args.days === 'string' ? args.days : 7);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = await selectAll<{ created_at: string; processed_at: string | null }>((from, to) => supabase.from(Tables.RAW_CONTENT)
    .select('created_at,processed_at').gte('created_at', since).order('id').range(from, to));
  const runs = await selectAll<{ triggered_by: string }>((from, to) => supabase.from(Tables.PIPELINE_RUN_TRACES)
    .select('triggered_by').eq('kind', 'ingest').gte('started_at', since).order('id').range(from, to));
  const s = summariseLatency(rows, runs);
  console.log(`Last ${days} days: ${s.read} items read, ${s.pending} still waiting`);
  console.log(`Time to read: median ${s.p50Minutes ?? '–'} min, 90th percentile ${s.p90Minutes ?? '–'} min`);
  console.log(`Read within 10 minutes: ${Math.round(s.within10Min * 100)}%  (F3 gate: new material read within 10 min)`);
  console.log(`Reading runs by trigger: ${JSON.stringify(s.runsBy)}  (cron share should fall toward 0)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
