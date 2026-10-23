/**
 * The onboarding pipeline: from "they just connected their data" to "their
 * first episode is ready", with nobody running anything by hand.
 *
 * Founder, 19 October 2026: the first episode should arrive without a tap,
 * once everything they connected has been read. Until now the first guess at
 * the 36 questions (the first pass) only ever ran when someone typed a command,
 * so a new tester would never have had one.
 *
 * Stages, in order:
 *   reading         their connected data is still being read
 *   understanding   read; the first pass at the 36 questions comes next
 *   making_episode  answered; the first episode comes next (or is being made)
 *   ready           a finished episode exists -- the app can bring them in
 *
 * advanceOnboarding() does the next step and is safe to call repeatedly.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export type OnboardingStage = 'reading' | 'understanding' | 'making_episode' | 'ready';

export interface OnboardingFacts {
  /** Integration jobs still queued or running. */
  outstandingJobs: number;
  /** Entries still waiting to be read. */
  outstandingRows: number;
  /** When the latest material arrived. */
  lastArrivalAt: string | null;
  /** When onboarding began (their account was created). */
  startedAt: string;
  answers: number;
  /**
   * First passes already tried: their spend_ledger rows (kind 'first_pass').
   * One run that finds nothing to answer still counts, so it is not re-run
   * every tick until the spending cap trips.
   */
  firstPassRuns: number;
  episodesReady: number;
  /** An episode run started in the last 15 minutes and not finished. */
  episodeRunning: boolean;
}

/** Quiet for this long with nothing outstanding counts as "everything read". */
export const QUIET_MS = 2 * 60 * 1000;
/** Never keep someone waiting on reading longer than this. */
export const READING_TIMEOUT_MS = 20 * 60 * 1000;

export function stageFor(f: OnboardingFacts, now: Date): OnboardingStage {
  const sinceStart = now.getTime() - new Date(f.startedAt).getTime();
  const quietFor = f.lastArrivalAt ? now.getTime() - new Date(f.lastArrivalAt).getTime() : Infinity;
  const nothingOutstanding = f.outstandingJobs === 0 && f.outstandingRows === 0;
  const readingDone = (nothingOutstanding && quietFor >= QUIET_MS) || sinceStart >= READING_TIMEOUT_MS;
  if (!readingDone) return 'reading';
  // The first pass runs once per person: after one try, even one that answered nothing, the episode comes next.
  if (f.answers === 0 && f.firstPassRuns === 0) return 'understanding';
  if (f.episodesReady === 0) return 'making_episode';
  return 'ready';
}

export async function loadOnboardingFacts(userId: string, db: typeof supabase = supabase, now = new Date()): Promise<OnboardingFacts> {
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const recent = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const [user, outstandingJobs, outstandingRows, latest, answers, firstPassRuns, episodesReady, running] = await Promise.all([
    db.from(Tables.USERS).select('created_at').eq('id', userId).single(),
    count(db.from(Tables.INTEGRATION_JOBS).select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['queued', 'leased', 'running'])),
    count(db.from(Tables.RAW_CONTENT).select('id', { count: 'exact', head: true }).eq('user_id', userId).in('processing_status', ['pending', 'processing'])),
    db.from(Tables.RAW_CONTENT).select('created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    count(db.from(Tables.QUESTION_ANSWERS).select('id', { count: 'exact', head: true }).eq('user_id', userId)),
    count(db.from(Tables.SPEND_LEDGER).select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'first_pass')),
    count(db.from(Tables.PODCAST_EPISODES).select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'ready')),
    count(db.from(Tables.PIPELINE_RUN_TRACES).select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'podcast').eq('status', 'running').gte('started_at', recent)),
  ]);
  return {
    outstandingJobs,
    outstandingRows,
    lastArrivalAt: (latest.data as { created_at?: string } | null)?.created_at ?? null,
    startedAt: (user.data as { created_at?: string } | null)?.created_at ?? now.toISOString(),
    answers,
    firstPassRuns,
    episodesReady,
    episodeRunning: running > 0,
  };
}

export interface AdvanceDeps {
  loadFacts: (userId: string) => Promise<OnboardingFacts>;
  firstPass: (userId: string) => Promise<unknown>;
  makeEpisode: (userId: string) => Promise<unknown>;
  mayMakeEpisode: (userId: string) => Promise<boolean>;
  now?: () => Date;
}

export type AdvanceAction = 'waiting_for_reading' | 'ran_first_pass' | 'made_episode' | 'episode_already_running' | 'over_spending_limit' | 'nothing_to_do';

export async function advanceOnboarding(userId: string, deps: AdvanceDeps): Promise<{ stage: OnboardingStage; action: AdvanceAction }> {
  const now = (deps.now ?? (() => new Date()))();
  const facts = await deps.loadFacts(userId);
  const stage = stageFor(facts, now);
  switch (stage) {
    case 'reading':
      return { stage, action: 'waiting_for_reading' };
    case 'understanding':
      await deps.firstPass(userId);
      return { stage, action: 'ran_first_pass' };
    case 'making_episode':
      if (facts.episodeRunning) return { stage, action: 'episode_already_running' };
      if (!(await deps.mayMakeEpisode(userId))) return { stage, action: 'over_spending_limit' };
      await deps.makeEpisode(userId);
      return { stage, action: 'made_episode' };
    default:
      return { stage, action: 'nothing_to_do' };
  }
}
