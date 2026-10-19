import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runPodcast } from '../pipelines/podcast';
import { checkDailySpend } from '../pipelines/spend-guard';

/**
 * Weekly cron job — generates a podcast for every user with anything new in
 * the last 14 days.
 *
 * It used to require an *insight* in that window. Facts-only reading (#31)
 * writes no insights, so that rule would have quietly ended weekly episodes for
 * everyone (found 19 October 2026). New material of any kind is the signal now.
 */
export async function runWeeklyPodcasts(): Promise<void> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from(Tables.RAW_CONTENT)
    .select('user_id')
    .gte('created_at', since);

  if (error) {
    console.error('[weekly-podcast] Failed to query users:', error.message);
    return;
  }

  const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
  console.log(`[weekly-podcast] ${userIds.length} eligible users`);

  for (const userId of userIds) {
    try {
      const spend = await checkDailySpend(userId);
      if (!spend.allowed) {
        console.warn(`[weekly-podcast] user=${userId} skipped: ${spend.message}`);
        continue;
      }
      const result = await runPodcast({ userId, triggeredBy: 'cron' });
      console.log(
        `[weekly-podcast] user=${userId} episode=${result.episodeId} title="${result.title}"`
      );
    } catch (err) {
      console.error(`[weekly-podcast] user=${userId} failed:`, err instanceof Error ? err.message : err);
    }
  }
}
