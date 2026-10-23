import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runFirstPass } from '../questions/run-first-pass';
import { runPodcast } from '../pipelines/podcast';
import { checkDailySpend } from '../pipelines/spend-guard';
import { recordSpend } from '../pipelines/spend-ledger';
import type { CostLine } from '../pipelines/trace';
import { advanceOnboarding, loadOnboardingFacts, type AdvanceDeps } from '../onboarding/pipeline';

export interface FirstPassStepDeps {
  checkSpend?: (userId: string) => Promise<{ allowed: boolean; message?: string }>;
  run?: (userId: string) => Promise<{ cost: CostLine[] }>;
  db?: typeof supabase;
  now?: () => Date;
}

/**
 * The first pass as the pipeline runs it. It writes answers but no trace: its
 * cost goes to the ledger (BEA.4). Episodes trace themselves.
 *
 * Every run that gets past the cap leaves at least one first_pass ledger row,
 * which is how the pipeline knows the first pass was tried (stageFor). A run
 * that called no model (nothing to read yet, or every domain skipped) costs
 * nothing, and recordSpend keeps only lines that cost something, so the
 * attempt is marked with a $0 row of its own.
 */
export function makeFirstPassStep(deps: FirstPassStepDeps = {}): AdvanceDeps['firstPass'] {
  const checkSpend = deps.checkSpend ?? checkDailySpend;
  const run = deps.run ?? runFirstPass;
  const db = deps.db ?? supabase;
  return async (userId) => {
    // One model call per domain: it obeys the cap like the episode step does (review, #138).
    // Refused, it records nothing, so the next tick tries again once the cap allows.
    const spend = await checkSpend(userId);
    if (!spend.allowed) {
      console.warn(`[onboarding-pipeline] user=${userId} first pass skipped: ${spend.message ?? 'over the spending limit'}`);
      return null;
    }
    const report = await run(userId);
    const now = (deps.now ?? (() => new Date()))();
    const written = await recordSpend(userId, 'first_pass', report.cost, { db, now });
    if (written === 0) {
      const { error } = await db.from(Tables.SPEND_LEDGER).insert({ user_id: userId, at: now.toISOString(), kind: 'first_pass', usd: 0, model: null });
      if (error) console.error(`[onboarding-pipeline] user=${userId} could not mark the first pass code=${error.code ?? 'unknown'}`);
    }
    return report;
  };
}

/** The real steps behind advanceOnboarding. */
export const defaultAdvanceDeps: AdvanceDeps = {
  loadFacts: (userId) => loadOnboardingFacts(userId),
  firstPass: makeFirstPassStep(),
  makeEpisode: (userId) => runPodcast({ userId, triggeredBy: 'cron', notes: 'first episode (onboarding pipeline)' }),
  mayMakeEpisode: async (userId) => (await checkDailySpend(userId)).allowed,
};

/** People mid-onboarding: accounts from the last three days. */
const ONBOARDING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const inFlight = new Set<string>();

/**
 * Every couple of minutes: move each person mid-onboarding one step along.
 * One step per person per tick, and never two ticks on the same person at once.
 */
export async function runOnboardingPipeline(deps: AdvanceDeps = defaultAdvanceDeps): Promise<void> {
  const since = new Date(Date.now() - ONBOARDING_WINDOW_MS).toISOString();
  const { data, error } = await supabase.from(Tables.USERS).select('id').gte('created_at', since);
  if (error) {
    console.error('[onboarding-pipeline] could not list new accounts:', error.message);
    return;
  }
  for (const { id } of (data ?? []) as Array<{ id: string }>) {
    if (inFlight.has(id)) continue;
    inFlight.add(id);
    try {
      const { stage, action } = await advanceOnboarding(id, deps);
      if (action !== 'nothing_to_do' && action !== 'waiting_for_reading') {
        console.log(`[onboarding-pipeline] user=${id} stage=${stage} -> ${action}`);
      }
    } catch (err) {
      console.error(`[onboarding-pipeline] user=${id} failed:`, err instanceof Error ? err.message : err);
    } finally {
      inFlight.delete(id);
    }
  }
}
