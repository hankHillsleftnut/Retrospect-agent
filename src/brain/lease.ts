/**
 * Lease lifecycle for raw_content.
 *
 * The pipeline already CLAIMS a lease (sets processing_status='processing'
 * with processing_started_at). Nothing ever reclaimed one. A worker that dies
 * mid-run therefore strands its rows in 'processing' permanently, with nothing
 * watching -- which is how 2,034 rows went dark after a billing lapse in May
 * 2026 and never came back.
 *
 * Three things fix that:
 *   reclaimExpiredLeases -- a dead run's rows return to 'pending'
 *   heartbeat            -- a live run keeps proving it is alive
 *   hasExistingFacts     -- a completed row is not re-extracted
 *
 * docs/second-brain/04 "Durability", 09 A3, 05 D11 (contract, not Temporal).
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { failureUpdate, MAX_ATTEMPTS } from '../pipelines/retry-policy';

/** Rows one reclaim pass may recover. Bounded like every other queue drain
 *  here; the remainder is picked up by the next pass. */
const RECLAIM_LIMIT_PER_RUN = 500;

/** How long a run may go silent before its work is considered abandoned. */
export const LEASE_TTL_MS = 15 * 60 * 1000;
/** How often a live run proves it is still alive. Must be well under the TTL. */
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export interface ReclaimResult {
  reclaimed: number;
  ids: string[];
}

/**
 * Return rows whose lease has expired to 'pending' so they can be retried.
 *
 * Safe to call concurrently: the status filter means two workers racing will
 * simply both see fewer rows, never double-claim.
 */
/**
 * Return rows to the queue, counting the reclaim as an attempt.
 *
 * Reclaiming without incrementing attempt_count leaves a hole in the attempt
 * ceiling. A row whose content kills the worker mid-batch -- an out-of-memory,
 * a hard timeout, an unhandled parser crash -- never reaches the failure
 * handler that does the counting, so it would be leased, orphaned, reclaimed
 * and leased again without limit, burning a call every cycle. The ceiling has
 * to apply to every path out of `processing`, not just the tidy one.
 */
async function requeueOrphaned(
  rows: { id: string; attempt_count: number | null }[],
  reason: string,
  // The same predicate the SELECT used, re-applied to the write.
  //
  // Counting attempts means this can no longer be one atomic UPDATE, so the
  // staleness check has to be carried across to the write by hand. Without it
  // the two statements disagree: the SELECT finds a row whose lease looks
  // expired, a heartbeat refreshes it in the gap, and the UPDATE -- checking
  // only the status -- tears a live lease out from under a worker that is
  // still running. Both then process the same row.
  guard: <Q>(q: Q) => Q,
): Promise<string[]> {
  const byAttempt = new Map<number, string[]>();
  for (const row of rows) {
    const n = row.attempt_count ?? 0;
    if (!byAttempt.has(n)) byAttempt.set(n, []);
    byAttempt.get(n)!.push(row.id);
  }

  const touched: string[] = [];
  for (const [attempts, ids] of byAttempt) {
    const update = failureUpdate(reason, attempts);
    const { data, error } = await guard(
      supabase
        .from(Tables.RAW_CONTENT)
        .update({ ...update, processing_started_at: null })
        .in('id', ids)
        .eq('processing_status', 'processing'),
    ).select('id');
    if (error) throw new Error(`Reclaim update failed: ${error.message}`);

    // Report what the write actually matched, not what we hoped to match: a
    // row that finished in the gap is correctly skipped, and counting it would
    // inflate the one number that says whether workers are dying.
    const changed = (data ?? []).map((r: { id: string }) => r.id);
    touched.push(...changed);

    if (changed.length > 0 && update.processing_status === 'failed') {
      console.warn(
        `[lease] ${changed.length} row(s) reclaimed for the last time (attempt ${update.attempt_count}/${MAX_ATTEMPTS}); giving up`
      );
    }
  }
  return touched;
}

export async function reclaimExpiredLeases(options: {
  userId?: string;
  ttlMs?: number;
} = {}): Promise<ReclaimResult> {
  const cutoff = new Date(Date.now() - (options.ttlMs ?? LEASE_TTL_MS)).toISOString();

  let query = supabase
    .from(Tables.RAW_CONTENT)
    .select('id, attempt_count')
    .eq('processing_status', 'processing')
    .lt('processing_started_at', cutoff)
    .limit(RECLAIM_LIMIT_PER_RUN);

  if (options.userId) query = query.eq('user_id', options.userId);

  const { data, error } = await query;
  if (error) throw new Error(`Reclaim expired leases failed: ${error.message}`);

  const ids = await requeueOrphaned(
    (data ?? []) as { id: string; attempt_count: number | null }[],
    'lease expired; reclaimed for retry',
    (q) => (q as any).lt('processing_started_at', cutoff),
  );
  return { reclaimed: ids.length, ids };
}

/**
 * Rows stuck in 'processing' with no start time at all -- written by a version
 * that claimed without stamping. They can never expire on their own.
 */
export async function reclaimUnstampedLeases(userId?: string): Promise<ReclaimResult> {
  let query = supabase
    .from(Tables.RAW_CONTENT)
    .select('id, attempt_count')
    .eq('processing_status', 'processing')
    .is('processing_started_at', null)
    .limit(RECLAIM_LIMIT_PER_RUN);
  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;
  if (error) throw new Error(`Reclaim unstamped leases failed: ${error.message}`);

  const ids = await requeueOrphaned(
    (data ?? []) as { id: string; attempt_count: number | null }[],
    'processing with no lease stamp; reclaimed for retry',
    (q) => (q as any).is('processing_started_at', null),
  );
  return { reclaimed: ids.length, ids };
}

/** Keeps a lease alive while a long run is legitimately still working. */
export function startHeartbeat(rawContentIds: string[], intervalMs = HEARTBEAT_INTERVAL_MS) {
  if (rawContentIds.length === 0) return { stop: () => {} };

  const timer = setInterval(() => {
    void supabase
      .from(Tables.RAW_CONTENT)
      .update({ processing_started_at: new Date().toISOString() })
      .in('id', rawContentIds)
      .eq('processing_status', 'processing')
      .then(
        () => {},
        (err: unknown) => console.warn(`[lease] heartbeat failed: ${String(err)}`)
      );
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();
  return { stop: () => clearInterval(timer) };
}

/**
 * Has this source already produced Facts?
 *
 * The idempotency question. Re-running ingest on a row that already has facts
 * is wasted LLM spend: origin keys mean the writes would upsert to exactly the
 * same rows.
 */
export async function hasExistingFacts(userId: string, rawContentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(Tables.ASSERTIONS)
    .select('id')
    .eq('user_id', userId)
    .like('origin_key', `journal:${rawContentId}:%`)
    .limit(1);
  if (error) return false; // never block ingest on a bookkeeping query
  return (data ?? []).length > 0;
}
