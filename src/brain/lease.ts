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
export async function reclaimExpiredLeases(options: {
  userId?: string;
  ttlMs?: number;
} = {}): Promise<ReclaimResult> {
  const cutoff = new Date(Date.now() - (options.ttlMs ?? LEASE_TTL_MS)).toISOString();

  let query = supabase
    .from(Tables.RAW_CONTENT)
    .update({
      processing_status: 'pending',
      processing_started_at: null,
      processing_error: 'lease expired; reclaimed for retry',
      // Due immediately, and explicitly IN the retry queue rather than treated
      // as fresh arrivals. A reclaimed row keeps its original created_at, so
      // leaving this null would put an old row back under the "recent content"
      // window it can never satisfy -- reclaimed, and unreachable all the same.
      next_attempt_at: new Date().toISOString(),
    })
    .eq('processing_status', 'processing')
    .lt('processing_started_at', cutoff);

  if (options.userId) query = query.eq('user_id', options.userId);

  const { data, error } = await query.select('id');
  if (error) throw new Error(`Reclaim expired leases failed: ${error.message}`);

  const ids = (data ?? []).map((r: { id: string }) => r.id);
  return { reclaimed: ids.length, ids };
}

/**
 * Rows stuck in 'processing' with no start time at all -- written by a version
 * that claimed without stamping. They can never expire on their own.
 */
export async function reclaimUnstampedLeases(userId?: string): Promise<ReclaimResult> {
  let query = supabase
    .from(Tables.RAW_CONTENT)
    .update({
      processing_status: 'pending',
      processing_error: 'processing with no lease stamp; reclaimed for retry',
      next_attempt_at: new Date().toISOString(),
    })
    .eq('processing_status', 'processing')
    .is('processing_started_at', null);
  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query.select('id');
  if (error) throw new Error(`Reclaim unstamped leases failed: ${error.message}`);
  const ids = (data ?? []).map((r: { id: string }) => r.id);
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
