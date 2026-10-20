/**
 * Refresh every pattern's trajectory for one person (W3.3b). Runs at the end
 * of each promoter pass. Instances are the pattern's facts, timed by when the
 * behaviour happened (event_time), falling back to when it was learned.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { trajectoryOf, windowCounts } from './trajectory';

const CHUNK = 100;

export async function refreshTrajectories(userId: string, db: typeof supabase = supabase, now = new Date()): Promise<Record<string, number>> {
  const { data: patterns, error } = await db.from(Tables.BEHAVIOR_PATTERNS).select('id').eq('user_id', userId);
  if (error) throw new Error(`refreshTrajectories patterns: ${error.message}`);
  const tally: Record<string, number> = {};
  for (const { id } of (patterns ?? []) as Array<{ id: string }>) {
    const { data: links } = await db.from(Tables.BEHAVIOR_PATTERN_FACTS).select('assertion_id').eq('pattern_id', id);
    const factIds = ((links ?? []) as Array<{ assertion_id: string }>).map((l) => l.assertion_id);
    const times: string[] = [];
    for (let i = 0; i < factIds.length; i += CHUNK) {
      const { data: facts } = await db.from(Tables.ASSERTIONS).select('event_time,observed_at,status,valid_to').in('id', factIds.slice(i, i + CHUNK));
      for (const f of (facts ?? []) as Array<{ event_time: string | null; observed_at: string; status: string; valid_to: string | null }>) {
        if (f.status === 'active' && !f.valid_to) times.push(f.event_time ?? f.observed_at);
      }
    }
    const { prior, recent } = windowCounts(times, now);
    const t = trajectoryOf(prior, recent);
    tally[t.trajectory] = (tally[t.trajectory] ?? 0) + 1;
    const { error: upErr } = await db.from(Tables.BEHAVIOR_PATTERNS)
      .update({ trajectory: t.trajectory, trajectory_detail: t, trajectory_at: now.toISOString() }).eq('id', id);
    if (upErr) throw new Error(`refreshTrajectories update: ${upErr.message}`);
  }
  return tally;
}
