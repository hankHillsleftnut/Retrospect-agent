/**
 * Which entries this ingest run will read, and the lease that keeps two runs
 * from reading the same one.
 *
 * This is the capture side of the capture/interpretation seam
 * (architecture-and-sequence §3, Phase 3.0). It decides *what* gets read and
 * never looks at *how* it is read, so changes to extraction cannot touch it.
 * Moved out of runIngest unchanged.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { envInt } from '../services/token-budget';
import {
  reclaimExpiredLeases,
  reclaimUnstampedLeases,
  startHeartbeat,
  hasExistingFacts,
} from '../brain/lease';
import type { DbRawContent } from '../types';

/**
 * How many overdue rows one run may pick up on top of new content.
 *
 * The backlog is thousands of rows. Without a bound, the first run after this
 * ships would try to process all of them at once -- an unbounded spend and a
 * guaranteed rate limit. The queue drains over successive runs instead.
 */
export const RETRY_LIMIT_PER_RUN = envInt('INGEST_RETRY_LIMIT', 25);

/**
 * Bound on NEW content too, not just retries.
 *
 * Retries were bounded and arrivals were not, which protects the backlog and
 * leaves the front door open: a bulk import or a connector backfill landing
 * hundreds of rows inside the window would issue hundreds of calls in a single
 * unbounded pass. Both sides drain over successive runs now.
 */
export const FRESH_LIMIT_PER_RUN = envInt('INGEST_FRESH_LIMIT', 200);

export interface ClaimOptions {
  userId: string;
  daysBack: number;
  rawContentIds?: string[];
  dryRun?: boolean;
  force?: boolean;
}

interface ClaimCounts {
  /** Rows a dead run left in 'processing', handed back for retry. */
  leasesReclaimed: number;
  /** Rows that already produced facts, marked done without a model call. */
  factsSkippedRows: number;
}

export type ClaimResult =
  | (ClaimCounts & { kind: 'empty'; note: string })
  | (ClaimCounts & {
      kind: 'work';
      rows: DbRawContent[];
      /** Leased ids; on failure these are the rows to release. Empty in a dry run. */
      leasedIds: string[];
      heartbeat: { stop: () => void };
    });

export async function claimWork(options: ClaimOptions): Promise<ClaimResult> {
  const sinceIso = new Date(Date.now() - options.daysBack * 24 * 60 * 60 * 1000).toISOString();
  let leasesReclaimed = 0;
  let factsSkippedRows = 0;

  // Reclaim abandoned work FIRST. A run that died mid-flight leaves its
  // rows in 'processing' forever; without this they are invisible to every
  // later run. This is what turns a transient outage into a retry instead
  // of permanent data loss.
  if (!options.dryRun) {
    const [expired, unstamped] = await Promise.all([
      reclaimExpiredLeases({ userId: options.userId }),
      reclaimUnstampedLeases(options.userId),
    ]);
    const reclaimed = expired.reclaimed + unstamped.reclaimed;
    if (reclaimed > 0) {
      console.log(`[ingest] reclaimed ${reclaimed} abandoned row(s) for retry`);
      leasesReclaimed = reclaimed;
    }
  }

  const empty = (note: string): ClaimResult => ({ kind: 'empty', note, leasesReclaimed, factsSkippedRows });

  let rows = await findCandidates(options, sinceIso);
  if (rows.length === 0) return empty('No new raw content found.');

  if (options.dryRun) {
    return { kind: 'work', rows, leasedIds: [], heartbeat: { stop: () => {} }, leasesReclaimed, factsSkippedRows };
  }

  const ids = rows.map((row) => row.id);
  let leaseQuery = supabase
    .from(Tables.RAW_CONTENT)
    .update({
      processing_status: 'processing',
      processing_error: null,
      processing_started_at: new Date().toISOString(),
    })
    .in('id', ids);
  if (!options.force) {
    leaseQuery = leaseQuery.in('processing_status', ['pending', 'failed']);
  }
  const { data: leasedRows, error: processingError } = await leaseQuery.select('*');
  if (processingError) throw new Error(`Mark raw_content processing failed: ${processingError.message}`);
  rows = (leasedRows ?? []) as DbRawContent[];

  // Idempotency: a row that already produced Facts does not need the LLM
  // again. Origin keys mean a re-extract would upsert to the same rows,
  // so this is purely saved spend -- and it makes retry cheap enough to
  // be the default response to a failure.
  if (!options.force && rows.length > 0) {
    const checks = await Promise.all(
      rows.map(async (row) => ({ row, done: await hasExistingFacts(options.userId, row.id) }))
    );
    const already = checks.filter((c) => c.done).map((c) => c.row.id);
    if (already.length > 0) {
      await supabase
        .from(Tables.RAW_CONTENT)
        .update({
          processing_status: 'completed',
          processing_started_at: null,
          processed_at: new Date().toISOString(),
        })
        .in('id', already);
      factsSkippedRows = already.length;
      console.log(`[ingest] ${already.length} row(s) already have facts; skipping extraction`);
      rows = checks.filter((c) => !c.done).map((c) => c.row);
    }
    if (rows.length === 0) return empty('All requested rows already produced facts.');
  }

  // Checked before the heartbeat starts, so an empty claim leaves no timer
  // running (previously it started one on an empty list and returned).
  if (rows.length === 0) {
    return empty('No raw content was eligible for processing; another run may hold the lease.');
  }

  const leasedIds = rows.map((row) => row.id);
  return {
    kind: 'work',
    rows,
    leasedIds,
    heartbeat: startHeartbeat(leasedIds),
    leasesReclaimed,
    factsSkippedRows,
  };
}

// Work comes from two places, and conflating them is what made the backlog
// unreachable.
//
//   NEW content is windowed by created_at, because "what has arrived since
//   I last looked" is genuinely a question about recency.
//
//   DUE RETRIES are not windowed at all. A row that failed in March is
//   still work to do; it does not become less worth processing by getting
//   older. The previous query applied the seven-day window to both, so any
//   failure that aged past a week fell off the edge of the world -- which,
//   with the retry cron disabled, is where two thousand entries went.
//
// Retries are bounded per run so that turning this on cannot fire off a
// two-thousand-row spend in one go. The queue drains over several runs
// instead, oldest first.
async function findCandidates(options: ClaimOptions, sinceIso: string): Promise<DbRawContent[]> {
  if (options.rawContentIds && options.rawContentIds.length > 0) {
    // Specific IDs requested — fetch them regardless of status or age.
    const { data, error } = await supabase
      .from(Tables.RAW_CONTENT)
      .select('*')
      .eq('user_id', options.userId)
      .in('id', options.rawContentIds);
    if (error) throw new Error(`Fetch raw_content failed: ${error.message}`);
    return (data ?? []) as DbRawContent[];
  }

  const nowIso = new Date().toISOString();

  // 1. Arrivals: pending, no due time, inside the window.
  const { data: fresh, error: freshErr } = await supabase
    .from(Tables.RAW_CONTENT)
    .select('*')
    .eq('user_id', options.userId)
    .eq('processing_status', 'pending')
    .is('next_attempt_at', null)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(FRESH_LIMIT_PER_RUN);
  if (freshErr) throw new Error(`Fetch raw_content failed: ${freshErr.message}`);

  // 2. Scheduled retries: due now, at any age.
  const { data: due, error: dueErr } = await supabase
    .from(Tables.RAW_CONTENT)
    .select('*')
    .eq('user_id', options.userId)
    .eq('processing_status', 'pending')
    .not('next_attempt_at', 'is', null)
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .limit(RETRY_LIMIT_PER_RUN);
  if (dueErr) throw new Error(`Fetch due retries failed: ${dueErr.message}`);

  // 3. Stranded: pending, no due time, and OUTSIDE the window.
  //
  // Splitting the first two queries apart left a gap exactly where the old
  // bug lived. A row in this state matches neither: too old for the
  // arrivals window, no due time for the retry queue. Fourteen rows were
  // sitting in it in production -- pending, never processed, and after the
  // split, unreachable by anything.
  //
  // Nothing should be able to sit in `pending` and never be looked at. The
  // window is an optimisation for finding new work quickly, not a statement
  // that older work has stopped mattering.
  const { data: stranded, error: strandedErr } = await supabase
    .from(Tables.RAW_CONTENT)
    .select('*')
    .eq('user_id', options.userId)
    .eq('processing_status', 'pending')
    .is('next_attempt_at', null)
    .lt('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(RETRY_LIMIT_PER_RUN);
  if (strandedErr) throw new Error(`Fetch stranded pending failed: ${strandedErr.message}`);

  const seen = new Set<string>();
  const rows = [...(fresh ?? []), ...(due ?? []), ...(stranded ?? [])].filter((r) => {
    const row = r as DbRawContent;
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  }) as DbRawContent[];

  if ((due ?? []).length > 0) {
    console.log(`[ingest]   including ${(due ?? []).length} due retries (limit ${RETRY_LIMIT_PER_RUN})`);
  }
  if ((stranded ?? []).length > 0) {
    console.log(`[ingest]   including ${(stranded ?? []).length} stranded pending rows older than the window`);
  }
  return rows;
}
