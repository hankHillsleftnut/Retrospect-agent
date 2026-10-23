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
  run?: (userId: string) => Promise<{ cost: CostLine[]; poolSize: number }>;
  db?: typeof supabase;
  now?: () => Date;
}

/**
 * The first pass as the pipeline runs it. It writes answers but no trace: its
 * cost goes to the ledger (BEA.4). Episodes trace themselves.
 *
 * A first_pass ledger row is how the pipeline knows the first pass was tried
 * (stageFor). A paid run leaves its cost rows. A run that had material but cost
 * nothing (every domain skipped) is marked with a $0 row, since recordSpend
 * keeps only lines that cost something. Two cases are left unmarked so the next
 * tick tries again: an empty pool (nothing has arrived yet; it calls no model,
 * so retrying is free), and a paid run whose cost could not be written (marking
 * it $0 would hide the spend from the cap).
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
    const paid = report.cost.some((l) => l.usd > 0);
    const written = await recordSpend(userId, 'first_pass', report.cost, { db, now });
    if (paid && written === 0) {
      console.error(`[onboarding-pipeline] user=${userId} first pass cost not recorded; it will be tried again`);
    } else if (!paid && report.poolSize > 0) {
      const { error } = await db.from(Tables.SPEND_LEDGER).insert({ user_id: userId, at: now.toISOString(), kind: 'first_pass', usd: 0, model: null });
      if (error) console.error(`[onboarding-pipeline] user=${userId} could not mark the first pass code=${error.code ?? 'unknown'}`);
    }
    return report;
  };
}

/**
 * One first pass per person at a time in this process. The cron's inFlight set
 * does not cover POST /onboarding/advance, which shares this step; without this
 * a call during a running pass would pay for a second one (review, #143).
 */
export function onePerPerson(step: AdvanceDeps['firstPass']): AdvanceDeps['firstPass'] {
  const running = new Set<string>();
  return async (userId) => {
    if (running.has(userId)) return null;
    running.add(userId);
    try {
      return await step(userId);
    } finally {
      running.delete(userId);
    }
  };
}

/** The real steps behind advanceOnboarding. */
export const defaultAdvanceDeps: AdvanceDeps = {
  loadFacts: (userId) => loadOnboardingFacts(userId),
  firstPass: onePerPerson(makeFirstPassStep()),
  makeEpisode: (userId) => runPodcast({ userId, triggeredBy: 'cron', notes: 'first episode (onboarding pipeline)' }),
  mayMakeEpisode: async (userId) => (await checkDailySpend(userId)).allowed,
};

/** People mid-onboarding: accounts, or onboarding answers, from the last three days. */
const ONBOARDING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const inFlight = new Set<string>();

/**
 * Accounts from the window, plus anyone whose onboarding answers arrived in it:
 * someone invited after waiting more than three days answers long after their
 * account was made, and would otherwise never be stepped (review, #144).
 */
async function peopleMidOnboarding(since: string): Promise<string[] | null> {
  const [accounts, answering] = await Promise.all([
    supabase.from(Tables.USERS).select('id').gte('created_at', since),
    supabase.from(Tables.RAW_CONTENT).select('user_id').eq('content_type', 'onboarding_profile').gte('created_at', since),
  ]);
  if (accounts.error) {
    console.error('[onboarding-pipeline] could not list new accounts:', accounts.error.message);
    return null;
  }
  if (answering.error) console.error(`[onboarding-pipeline] could not list recent answers code=${answering.error.code ?? 'unknown'}`);
  const ids = new Set(((accounts.data ?? []) as Array<{ id: string }>).map((r) => r.id));
  for (const r of (answering.data ?? []) as Array<{ user_id: string }>) ids.add(r.user_id);
  return [...ids];
}

/**
 * Every couple of minutes: move each person mid-onboarding one step along.
 * One step per person per tick, and never two ticks on the same person at once.
 */
export async function runOnboardingPipeline(deps: AdvanceDeps = defaultAdvanceDeps): Promise<void> {
  const since = new Date(Date.now() - ONBOARDING_WINDOW_MS).toISOString();
  const people = await peopleMidOnboarding(since);
  if (!people) return;
  for (const id of people) {
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
