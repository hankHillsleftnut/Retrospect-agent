/**
 * New material for someone -> read it, then research it (F3.2).
 *
 * Migration 132 keeps one "material arrived" row per person. Every minute this
 * claims the people who have gone quiet (or waited too long), reads what came
 * in and lets the researcher re-read the questions it bears on. The daily crons
 * stay as the net; F3.3 measures how much still falls through to them.
 *
 * Debounced on purpose: someone pasting ten notes should be read once, after
 * the tenth, not ten times.
 */

import { supabase } from '../db/supabase';

/** Quiet this long and their material is read. */
export const QUIET = '2 minutes';
/** Never wait longer than this, even if they keep sending. */
export const MAX_WAIT = '10 minutes';
/** A claim older than this belonged to a worker that died. */
export const LEASE = '30 minutes';

export interface Claim { user_id: string; claimed_at: string; arrivals: number }
export type Outcome = 'done' | 'more_arrived' | 'released' | 'deferred';

export interface ArrivalDeps {
  claim(): Promise<Claim[]>;
  finish(c: Claim, succeeded: boolean): Promise<Outcome>;
  /** False when today's spend cap is reached: the claim is left to lapse and retried later. */
  mayRun(userId: string): Promise<boolean>;
  read(userId: string): Promise<void>;
  research(userId: string): Promise<void>;
}

export async function handleArrivals(deps: ArrivalDeps): Promise<Array<{ userId: string; outcome: Outcome; error?: string }>> {
  const results: Array<{ userId: string; outcome: Outcome; error?: string }> = [];
  for (const c of await deps.claim()) {
    if (!(await deps.mayRun(c.user_id))) {
      results.push({ userId: c.user_id, outcome: 'deferred' });
      continue;
    }
    try {
      await deps.read(c.user_id);
      await deps.research(c.user_id);
      results.push({ userId: c.user_id, outcome: await deps.finish(c, true) });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ userId: c.user_id, outcome: await deps.finish(c, false), error });
    }
  }
  return results;
}

export const claimFromDb = async (db: typeof supabase = supabase): Promise<Claim[]> => {
  const { data, error } = await db.rpc('claim_material_arrivals', { p_quiet: QUIET, p_max_wait: MAX_WAIT, p_lease: LEASE });
  if (error) throw new Error(`claim_material_arrivals: ${error.message}`);
  return (data ?? []) as Claim[];
};

export const finishInDb = async (c: Claim, succeeded: boolean, db: typeof supabase = supabase): Promise<Outcome> => {
  const { data, error } = await db.rpc('finish_material_arrival', { p_user: c.user_id, p_claimed_at: c.claimed_at, p_succeeded: succeeded });
  if (error) throw new Error(`finish_material_arrival: ${error.message}`);
  return data as Outcome;
};
