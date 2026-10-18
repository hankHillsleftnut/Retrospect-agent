import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runResearch } from '../questions/run-research';

/**
 * Daily: research the canonical questions for everyone with new material.
 *
 * Runs after daily ingestion, so the day's writing has become facts first.
 * Someone with nothing new is skipped outright -- research only ever looks at
 * what arrived since it last looked, so there would be nothing to read.
 */
export async function runQuestionResearch(): Promise<void> {
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase.from(Tables.RAW_CONTENT).select('user_id').gte('created_at', since);
  if (error) {
    console.error('[question-research] could not find users with new material:', error.message);
    return;
  }

  const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
  console.log(`[question-research] ${userIds.length} users with new material`);
  for (const userId of userIds) {
    try {
      const { researched, costUsd } = await runResearch(userId);
      const tally = researched.reduce<Record<string, number>>((t, r) => ({ ...t, [r.outcome]: (t[r.outcome] ?? 0) + 1 }), {});
      console.log(`[question-research] user=${userId} ${JSON.stringify(tally)} $${costUsd.toFixed(3)}`);
    } catch (err) {
      console.error(`[question-research] user=${userId} failed:`, err instanceof Error ? err.message : err);
    }
  }
}
