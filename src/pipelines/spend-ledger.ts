/**
 * The spend ledger (BEA.4): one row per cost line for every model call that
 * has no pipeline trace of its own, so the daily cap (spend-guard.ts) sees all
 * of a person's spending, not just episodes and reading.
 *
 * Who writes here: conversation, corrections, search answers, briefs (route,
 * cron and CLI, since the brief engine records itself), onboarding goals and
 * interpretation, the first pass, notifications. Who must not: anything that
 * already persists a pipeline_run_traces row (ingest, episodes) or a
 * question_research_log row (the researcher) -- the guard sums those tables
 * too, and a path that wrote both would be counted twice.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import type { ClaudeUsage } from '../services/anthropic';
import { costLines, type CostLine } from './trace';

/** What the money was for. A closed list: it is logged and summed by name. */
export type SpendKind =
  | 'conversation'
  | 'correction'
  | 'search'
  | 'brief'
  | 'brief_audio'
  | 'onboarding_goals'
  | 'onboarding_interpret'
  | 'first_pass'
  | 'notification';

/** Cost lines for token usage attributed to models, priced by the trace price table. */
export function usageLines(entries: Array<{ model: string; usage: ClaudeUsage; calls?: number }>): CostLine[] {
  const by_model: Record<string, { input: number; output: number; calls: number }> = {};
  let input = 0, output = 0;
  for (const e of entries) {
    if (e.usage.inputTokens === 0 && e.usage.outputTokens === 0) continue;
    const m = (by_model[e.model] ??= { input: 0, output: 0, calls: 0 });
    m.input += e.usage.inputTokens;
    m.output += e.usage.outputTokens;
    m.calls += e.calls ?? 1;
    input += e.usage.inputTokens;
    output += e.usage.outputTokens;
  }
  return costLines({
    openai_tokens_input: 0, openai_tokens_output: 0,
    anthropic_tokens_input: input, anthropic_tokens_output: output,
    embedding_tokens: 0, perplexity_calls: 0, elevenlabs_chars: 0, est_usd: 0,
    by_model,
  });
}

/**
 * Write the lines that cost something. Returns the dollars written.
 *
 * Never throws: the money is already spent by the time this runs, and failing
 * the person's reply would lose the answer without recovering a cent. A failed
 * write is logged as a count and an error code, never a row value.
 */
export async function recordSpend(
  userId: string,
  kind: SpendKind,
  lines: CostLine[],
  options: { db?: typeof supabase; now?: Date } = {},
): Promise<number> {
  const db = options.db ?? supabase;
  const at = (options.now ?? new Date()).toISOString();
  const rows = lines.filter((l) => l.usd > 0).map((l) => ({ user_id: userId, at, kind, usd: l.usd, model: l.model }));
  if (!rows.length) return 0;
  const { error } = await db.from(Tables.SPEND_LEDGER).insert(rows);
  if (error) {
    console.error(`[spend-ledger] could not record ${rows.length} line(s) kind=${kind} code=${error.code ?? 'unknown'}`);
    return 0;
  }
  return rows.reduce((sum, r) => sum + r.usd, 0);
}
