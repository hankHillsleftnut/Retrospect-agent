/**
 * What one person has cost in the last day, and a ceiling on it.
 *
 * Before testers arrive (docs/second-brain/tester-readiness.md): a single
 * onboarding was making two full episodes (~$4), and the founder's first day
 * of connected data came to ~$9. Without a ceiling, twenty testers could run
 * up a bill nobody decided on.
 *
 * Spend is read from three places: pipeline_run_traces (ingest, episodes),
 * question_research_log (the researcher) and the spend ledger (BEA.4: every
 * other model call -- conversation, search, corrections, briefs, onboarding,
 * notifications). Over the ceiling, model-calling routes refuse with 429
 * spend_limited. Reads are never refused (founder rule): refusing to show
 * someone their own data would strand it.
 *
 * In staging (RETROSPECT_ENV=staging) STAGING_DAILY_CAP_USD adds a ceiling on
 * the whole project, so a test fleet cannot run up a bill either.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { envInt } from '../services/token-budget';
import { selectAll } from '../db/paged';

/** Dollars per person per rolling 24 hours. USER_DAILY_SPEND_CAP_USD overrides; 0 turns the ceiling off. */
export const DAILY_SPEND_CAP_USD = envInt('USER_DAILY_SPEND_CAP_USD', 15);

export interface SpendSummary {
  userId: string;
  since: string;
  byKind: Record<string, number>;
  totalUsd: number;
}

type TraceRow = { kind: string; cost_breakdown: { est_usd?: number } | null };
type ResearchRow = { cost_usd: number | string };
type LedgerRow = { kind: string; usd: number | string };

function sumSources(traces: TraceRow[], research: ResearchRow[], ledger: LedgerRow[]): { byKind: Record<string, number>; totalUsd: number } {
  const byKind: Record<string, number> = {};
  for (const t of traces) byKind[t.kind] = (byKind[t.kind] ?? 0) + Number(t.cost_breakdown?.est_usd ?? 0);
  const researched = research.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  if (researched > 0) byKind.research = researched;
  for (const l of ledger) byKind[l.kind] = (byKind[l.kind] ?? 0) + Number(l.usd ?? 0);
  const totalUsd = Object.values(byKind).reduce((a, b) => a + b, 0);
  return { byKind, totalUsd };
}

/**
 * The three sources, read in full. PostgREST answers at most 1,000 rows per
 * request, so every read pages (db/paged.ts); a sum over the first page alone
 * would silently undercount a busy day, and the staging cap most of all.
 */
async function readSources(since: string, db: typeof supabase, userId?: string) {
  const [traces, research, ledger] = await Promise.all([
    selectAll<TraceRow>((f, t) => {
      const q = db.from(Tables.PIPELINE_RUN_TRACES).select('kind,cost_breakdown').gte('started_at', since).order('id').range(f, t);
      return userId ? q.eq('user_id', userId) : q;
    }),
    selectAll<ResearchRow>((f, t) => {
      const q = db.from(Tables.QUESTION_RESEARCH_LOG).select('cost_usd').gte('researched_at', since).order('id').range(f, t);
      return userId ? q.eq('user_id', userId) : q;
    }),
    selectAll<LedgerRow>((f, t) => {
      const q = db.from(Tables.SPEND_LEDGER).select('kind,usd').gte('at', since).order('id').range(f, t);
      return userId ? q.eq('user_id', userId) : q;
    }),
  ]);
  return sumSources(traces, research, ledger);
}

export async function spendSince(userId: string, since: string, db: typeof supabase = supabase): Promise<SpendSummary> {
  return { userId, since, ...(await readSources(since, db, userId)) };
}

/** Everyone's spending since `since`: the staging project cap. */
export async function projectSpendSince(since: string, db: typeof supabase = supabase): Promise<{ since: string; byKind: Record<string, number>; totalUsd: number }> {
  return { since, ...(await readSources(since, db)) };
}

/** The project-wide ceiling, only in staging. 0 or unset means none. */
export function stagingCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  if (env.RETROSPECT_ENV !== 'staging') return 0;
  const raw = Number(env.STAGING_DAILY_CAP_USD ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export type SpendDecision =
  | { allowed: true; spentUsd: number; capUsd: number }
  | { allowed: false; spentUsd: number; capUsd: number; scope: 'person' | 'project'; message: string };

/** May this person start something expensive now? */
export async function checkDailySpend(
  userId: string,
  options: { capUsd?: number; now?: Date; db?: typeof supabase; env?: NodeJS.ProcessEnv } = {},
): Promise<SpendDecision> {
  const capUsd = options.capUsd ?? DAILY_SPEND_CAP_USD;
  const since = new Date((options.now ?? new Date()).getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { totalUsd } = await spendSince(userId, since, options.db);
  if (capUsd > 0 && totalUsd >= capUsd) {
    return {
      allowed: false,
      spentUsd: totalUsd,
      capUsd,
      scope: 'person',
      message: `Daily limit reached: $${totalUsd.toFixed(2)} of $${capUsd} in the last 24 hours. Try again tomorrow.`,
    };
  }
  const projectCap = stagingCapUsd(options.env);
  if (projectCap > 0) {
    const project = await projectSpendSince(since, options.db);
    if (project.totalUsd >= projectCap) {
      // The figures are the project's: that is the ceiling that was hit.
      return {
        allowed: false,
        spentUsd: project.totalUsd,
        capUsd: projectCap,
        scope: 'project',
        message: `Staging limit reached: $${project.totalUsd.toFixed(2)} of $${projectCap} across everyone in the last 24 hours.`,
      };
    }
  }
  return { allowed: true, spentUsd: totalUsd, capUsd };
}

/** The 429 body every model-calling route answers with when refused (BEA.4). */
export function spendLimitedBody(d: Extract<SpendDecision, { allowed: false }>): { error: 'spend_limited'; spentUsd: number; capUsd: number; scope: 'person' | 'project'; message: string } {
  return { error: 'spend_limited', spentUsd: d.spentUsd, capUsd: d.capUsd, scope: d.scope, message: d.message };
}
