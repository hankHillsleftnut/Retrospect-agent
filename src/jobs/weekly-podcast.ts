import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runPodcast } from '../pipelines/podcast';

/**
 * Weekly cron job — generates a podcast for every active user
 * who has at least one insight in the last 14 days.
 */
export async function runWeeklyPodcasts(): Promise<void> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from(Tables.INSIGHTS)
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
      const result = await runPodcast({ userId, triggeredBy: 'cron' });
      console.log(
        `[weekly-podcast] user=${userId} episode=${result.episodeId} title="${result.title}"`
      );
    } catch (err) {
      console.error(`[weekly-podcast] user=${userId} failed:`, err instanceof Error ? err.message : err);
    }
  }
}
