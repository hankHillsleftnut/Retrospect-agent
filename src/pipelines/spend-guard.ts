/**
 * What one person has cost in the last day, and a ceiling on it.
 *
 * Before testers arrive (docs/second-brain/tester-readiness.md): a single
 * onboarding was making two full episodes (~$4), and the founder's first day
 * of connected data came to ~$9. Without a ceiling, twenty testers could run
 * up a bill nobody decided on.
 *
 * Spend is read from what each run already records: pipeline_run_traces
 * (ingest, episodes) and question_research_log (the researcher). Only new
 * episodes are refused over the ceiling -- they are the expensive part, and
 * refusing to read someone's data would strand it.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { envInt } from '../services/token-budget';

/** Dollars per person per rolling 24 hours. USER_DAILY_SPEND_CAP_USD overrides; 0 turns the ceiling off. */
export const DAILY_SPEND_CAP_USD = envInt('USER_DAILY_SPEND_CAP_USD', 15);

export interface SpendSummary {
  userId: string;
  since: string;
  byKind: Record<string, number>;
  totalUsd: number;
}

export async function spendSince(userId: string, since: string, db: typeof supabase = supabase): Promise<SpendSummary> {
  const [{ data: traces }, { data: research }] = await Promise.all([
    db.from(Tables.PIPELINE_RUN_TRACES).select('kind,cost_breakdown').eq('user_id', userId).gte('started_at', since),
    db.from(Tables.QUESTION_RESEARCH_LOG).select('cost_usd').eq('user_id', userId).gte('researched_at', since),
  ]);
  const byKind: Record<string, number> = {};
  for (const t of (traces ?? []) as Array<{ kind: string; cost_breakdown: { est_usd?: number } | null }>) {
    byKind[t.kind] = (byKind[t.kind] ?? 0) + Number(t.cost_breakdown?.est_usd ?? 0);
  }
  const researched = ((research ?? []) as Array<{ cost_usd: number | string }>).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  if (researched > 0) byKind.research = researched;
  const totalUsd = Object.values(byKind).reduce((a, b) => a + b, 0);
  return { userId, since, byKind, totalUsd };
}

export type SpendDecision = { allowed: true; spentUsd: number; capUsd: number } | { allowed: false; spentUsd: number; capUsd: number; message: string };

/** May this person start something expensive now? */
export async function checkDailySpend(
  userId: string,
  options: { capUsd?: number; now?: Date; db?: typeof supabase } = {},
): Promise<SpendDecision> {
  const capUsd = options.capUsd ?? DAILY_SPEND_CAP_USD;
  const since = new Date((options.now ?? new Date()).getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { totalUsd } = await spendSince(userId, since, options.db);
  if (capUsd > 0 && totalUsd >= capUsd) {
    return {
      allowed: false,
      spentUsd: totalUsd,
      capUsd,
      message: `Daily limit reached: $${totalUsd.toFixed(2)} of $${capUsd} in the last 24 hours. Try again tomorrow.`,
    };
  }
  return { allowed: true, spentUsd: totalUsd, capUsd };
}
