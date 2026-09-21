#!/usr/bin/env tsx
/**
 * Put abandoned rows back in the queue.
 *
 * Thousands of rows are marked `failed` that were never really judged: the
 * retry path was disabled, so they failed once and were left. Most of them are
 * rate limits and timeouts -- entirely processable, simply never tried again.
 *
 * Requeuing them is the largest single spend this system can incur, so nothing
 * here happens by accident. It reports first, applies only when told to, and is
 * bounded every time. There is no flag that means "all of it".
 */
import { createHash } from 'node:crypto';
import { parseArgs, requireArg, optNum, optBool, optStr } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { classifyFailure } from '../src/pipelines/retry-policy';

/** Never requeue more than this in one invocation, whatever is asked for. */
const HARD_CAP = 500;

/** Rough cost per entry, for the estimate printed before anything is written. */
const EST_USD_PER_ENTRY = 0.02;

type Row = { id: string; processing_error: string | null; created_at: string; content: string | null };

/**
 * Collapse rows holding identical content down to one apiece.
 *
 * This is a correctness requirement, not an economy. A broken importer wrote
 * the same 18 documents 1,357 times -- one of them 264 times on a single day.
 * The promoter decides what counts as a pattern by counting how often
 * something recurs, so requeuing those as-is would hand it 264 instances of a
 * single Tuesday and let a sync bug present itself as a person's defining
 * habit. Money is the smaller problem.
 *
 * The oldest copy is kept, since its created_at is the one that reflects when
 * the material actually arrived.
 */
function dedupe(rows: Row[]): { kept: Row[]; collapsed: number } {
  const byHash = new Map<string, Row>();
  for (const r of rows) {
    const hash = createHash('sha1').update(r.content ?? '').digest('hex');
    const existing = byHash.get(hash);
    if (!existing || r.created_at < existing.created_at) byHash.set(hash, r);
  }
  const kept = [...byHash.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { kept, collapsed: rows.length - kept.length };
}

async function main() {
  const args = parseArgs();
  const userId = requireArg(args, 'user');
  const limit = Math.min(optNum(args, 'limit') ?? 50, HARD_CAP);
  const apply = optBool(args, 'apply');
  const only = optStr(args, 'only'); // optional substring filter on the error
  // Deduplication is ON unless explicitly disabled: requeuing duplicates is
  // actively harmful to the fact bank, so it should take a deliberate act.
  const noDedupe = optBool(args, 'no-dedupe');

  const { data, error } = await supabase
    .from(Tables.RAW_CONTENT)
    .select('id, processing_error, created_at, content')
    .eq('user_id', userId)
    .eq('processing_status', 'failed')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`query failed: ${error.message}`);
  const rows = (data ?? []) as Row[];

  if (rows.length === 0) {
    console.log('No failed rows for this user. Nothing to do.');
    return;
  }

  // Group by the kind of failure, so it is obvious what is actually being
  // requeued rather than a single opaque number.
  const buckets = new Map<string, Row[]>();
  for (const r of rows) {
    const msg = r.processing_error ?? '(no error recorded)';
    const kind = classifyFailure(msg);
    const key = `${kind}: ${msg.slice(0, 70)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  console.log(`\n${rows.length} failed rows for user ${userId}\n`);
  const sorted = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [key, group] of sorted) {
    console.log(`  ${String(group.length).padStart(5)}  ${key}`);
  }

  const retryable = rows.filter(
    (r) => classifyFailure(r.processing_error ?? '') === 'transient',
  );
  const filtered = only
    ? retryable.filter((r) => (r.processing_error ?? '').toLowerCase().includes(only.toLowerCase()))
    : retryable;

  const { kept, collapsed } = noDedupe
    ? { kept: filtered, collapsed: 0 }
    : dedupe(filtered);

  if (collapsed > 0) {
    console.log(
      `\n  ${collapsed} duplicate row(s) collapsed -> ${kept.length} distinct document(s)` +
        `${noDedupe ? '' : '   (pass --no-dedupe to requeue every copy)'}`,
    );
  }

  const selected = kept.slice(0, limit);
  const chars = selected.reduce((n, r) => n + (r.content?.length ?? 0), 0);

  console.log(`\n  retryable (transient): ${retryable.length}`);
  if (only) console.log(`  matching --only "${only}": ${filtered.length}`);
  console.log(`  distinct after dedupe: ${kept.length}`);
  console.log(`  would requeue now:     ${selected.length} (limit ${limit}, hard cap ${HARD_CAP})`);
  console.log(`  content:               ${chars.toLocaleString()} chars`);
  console.log(`  rough cost:            ~$${(selected.length * EST_USD_PER_ENTRY).toFixed(2)}`);
  console.log(`  remaining after:       ${kept.length - selected.length}`);

  if (!apply) {
    console.log(`\nDry run. Nothing written. Re-run with --apply to requeue these ${selected.length}.`);
    return;
  }

  if (selected.length === 0) {
    console.log('\nNothing to requeue.');
    return;
  }

  // Due immediately, attempt history cleared: these genuinely have never been
  // retried, because the retry path never ran.
  const { error: updateErr, count } = await supabase
    .from(Tables.RAW_CONTENT)
    .update(
      {
        processing_status: 'pending',
        processing_error: null,
        processing_started_at: null,
        attempt_count: 0,
        failure_kind: null,
        next_attempt_at: new Date().toISOString(),
      },
      { count: 'exact' },
    )
    .in('id', selected.map((r) => r.id))
    .eq('processing_status', 'failed'); // no-op if something changed underneath

  if (updateErr) throw new Error(`requeue failed: ${updateErr.message}`);

  console.log(`\nRequeued ${count ?? selected.length} rows. They will be picked up by the next ingestion run,`);
  console.log(`up to INGEST_RETRY_LIMIT per run. Run again to requeue the next batch.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
