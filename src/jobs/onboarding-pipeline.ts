import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runFirstPass } from '../questions/run-first-pass';
import { runPodcast } from '../pipelines/podcast';
import { checkDailySpend } from '../pipelines/spend-guard';
import { advanceOnboarding, loadOnboardingFacts, type AdvanceDeps } from '../onboarding/pipeline';

/** The real steps behind advanceOnboarding. */
export const defaultAdvanceDeps: AdvanceDeps = {
  loadFacts: (userId) => loadOnboardingFacts(userId),
  firstPass: (userId) => runFirstPass(userId),
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
