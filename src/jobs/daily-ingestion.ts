import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runIngest } from '../pipelines/ingest';
import { isAmbientOn, pendingSentIds } from '../ambient/switch';
import { SENT_TYPES } from '../planner/daily';
import { refreshRecordBehaviour } from '../brain/record-patterns';
import { placeUnrecognisedEvents } from '../brain/place-events';
import { applyGoalLifecycle } from '../goals/lifecycle';

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
      if (!(await isAmbientOn(userId))) {
        // Ambient off: only what they sent is read; nothing else runs for them.
        const ids = await pendingSentIds(userId, SENT_TYPES);
        if (ids.length) await runIngest({ userId, rawContentIds: ids, triggeredBy: 'cron', notes: 'ambient off: sent only' });
        continue;
      }
      const result = await runIngest({ userId, daysBack: 7, triggeredBy: 'cron' });
      await placeUnrecognisedEvents(userId);
      await refreshRecordBehaviour(userId, 14);
      // Goals merge and expire (goal 7); deterministic, no model cost.
      await applyGoalLifecycle(userId);
      console.log(
        `[daily-ingestion] user=${userId} obs=${result.observations_created} ins=${result.insights_created} cand=${result.goal_candidates_created}`
      );
    } catch (err) {
      console.error(`[daily-ingestion] user=${userId} failed:`, err instanceof Error ? err.message : err);
    }
  }
}
