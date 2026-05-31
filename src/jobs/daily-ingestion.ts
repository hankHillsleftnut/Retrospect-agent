import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runIngest } from '../pipelines/ingest';

/**
 * Daily cron job — runs the ingestion pipeline for every active user
 * who has new raw_content in the last 24 hours.
 */
export async function runDailyIngestion(): Promise<void> {
  // Look back 7 days so entries that failed while the agent was down get retried.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from(Tables.RAW_CONTENT)
    .select('user_id')
    .gte('created_at', since);

  if (error) {
    console.error('[daily-ingestion] Failed to query users with new content:', error.message);
    return;
  }

  const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
  console.log(`[daily-ingestion] ${userIds.length} users with new content`);

  for (const userId of userIds) {
    try {
      const result = await runIngest({ userId, daysBack: 7, triggeredBy: 'cron' });
      console.log(
        `[daily-ingestion] user=${userId} obs=${result.observations_created} ins=${result.insights_created} cand=${result.goal_candidates_created}`
      );
    } catch (err) {
      console.error(`[daily-ingestion] user=${userId} failed:`, err instanceof Error ? err.message : err);
    }
  }
}
