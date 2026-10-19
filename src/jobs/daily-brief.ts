import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runDailyBrief } from '../briefs/run-daily-brief';
import { checkDailySpend } from '../pipelines/spend-guard';

/** Every morning: today's brief for each person who switched it on, within the spending ceiling. */
export async function runDailyBriefs(): Promise<void> {
  const { data, error } = await supabase.from(Tables.USERS).select('id').eq('daily_brief_enabled', true);
  if (error) {
    console.error('[daily-brief] could not list people:', error.message);
    return;
  }
  for (const { id } of (data ?? []) as Array<{ id: string }>) {
    try {
      if (!(await checkDailySpend(id)).allowed) {
        console.warn(`[daily-brief] user=${id} skipped: over the daily spending limit`);
        continue;
      }
      const r = await runDailyBrief(id);
      console.log(`[daily-brief] user=${id} ${r.brief.kind} items=${r.brief.items.length} dropped=${r.brief.dropped} $${r.costUsd.toFixed(3)}`);
    } catch (err) {
      console.error(`[daily-brief] user=${id} failed:`, err instanceof Error ? err.message : err);
    }
  }
}
