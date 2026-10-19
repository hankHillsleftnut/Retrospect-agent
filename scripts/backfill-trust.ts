#!/usr/bin/env tsx
/**
 * `npm run trust:backfill -- [--user <id>] [--apply]` -- record the trust class
 * of rows stored before W1. Preview by default: prints counts per class only
 * (never contents). Needs migration 129.
 */
import 'dotenv/config';
import { parseArgs } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { trustForRow } from '../src/brain/trust';
import { stampTrustClasses } from '../src/brain/trust-stamp';

async function main() {
  const args = parseArgs();
  const apply = args.apply === true;
  let q = supabase.from(Tables.RAW_CONTENT).select('id,content_type,authorship,content,metadata').is('trust_class', null).limit(5000);
  if (typeof args.user === 'string') q = q.eq('user_id', args.user);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; content_type: string; authorship: string | null; content: string | null; metadata: unknown }>;
  const counts: Record<string, number> = {};
  for (const r of rows) counts[trustForRow(r)] = (counts[trustForRow(r)] ?? 0) + 1;
  console.log(`${rows.length} row(s) without a trust class:`, counts);
  if (!apply) return console.log('Preview only. Re-run with --apply to record them.');
  console.log('Recorded:', await stampTrustClasses(rows));
}

main().catch((err) => { console.error(err); process.exit(1); });
