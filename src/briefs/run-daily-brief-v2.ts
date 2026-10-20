/**
 * The daily brief from the new brain (D1.4): read contract -> daily plan
 * (what they sent first, D1.2) -> its own writer, claim-checked (D1.3) -> the
 * same daily_briefs record. Behind a per-person switch (dailyV2For).
 *
 * The spoken text goes in through_line; items carry planId so tomorrow's plan
 * can discount what was said today (novelty decays).
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { estimateCostUsd, costLines } from '../pipelines/trace';
import { readUnderstanding } from '../understanding/read';
import { readDailyInputs, planDaily } from '../planner/daily';
import { briefSections, writeBrief } from '../writer/write-brief';
import type { BriefRun } from './run-daily-brief';

/** DAILY_PLANNER=v2 for everyone, or DAILY_PLANNER_V2_USERS=<id,id> for a few. */
export function dailyV2For(userId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DAILY_PLANNER === 'v2') return true;
  return (env.DAILY_PLANNER_V2_USERS ?? '').split(',').map((s) => s.trim()).filter(Boolean).includes(userId);
}

export async function runDailyBriefV2(userId: string, deps: { db?: typeof supabase; now?: Date; dryRun?: boolean } = {}): Promise<BriefRun> {
  const db = deps.db ?? supabase;
  const now = deps.now ?? new Date();
  const briefDate = now.toISOString().slice(0, 10);
  const [contract, inputs] = await Promise.all([readUnderstanding(userId, db, now), readDailyInputs(userId, db, now)]);
  const plan = planDaily(contract, inputs);
  const sections = briefSections(plan, {
    goals: contract.goals.map((g) => g.title),
    answers: contract.answers.filter((a) => a.register === 'stated').map((a) => `${a.question} ${a.answer}`),
  });
  const written = await writeBrief(sections, { asOf: briefDate });

  const w = written.usage.writer, g = written.usage.guard;
  const breakdown = {
    openai_tokens_input: 0, openai_tokens_output: 0, embedding_tokens: 0, perplexity_calls: 0, elevenlabs_chars: 0, est_usd: 0,
    anthropic_tokens_input: w.inputTokens + g.inputTokens, anthropic_tokens_output: w.outputTokens + g.outputTokens,
    by_model: { [config.anthropic.writerModel]: { input: w.inputTokens, output: w.outputTokens, calls: 1 }, [config.anthropic.guardModel]: { input: g.inputTokens, output: g.outputTokens, calls: g.inputTokens ? 1 : 0 } },
  };
  const costUsd = estimateCostUsd(breakdown as never).usd;
  const brief = {
    kind: (plan.quiet ? 'quiet' : 'brief') as 'brief' | 'quiet',
    throughLine: written.text || 'A quiet day: nothing new to bring you.',
    spineQuestionId: null, spineMovement: null,
    items: [
      ...plan.inbox.map((i) => ({ planId: `inbox:${i.id}`, text: i.preview, why: null, quote: i.preview, sourceRef: { raw_content_id: i.id } })),
      ...plan.items.map((i) => ({ planId: i.id, text: i.kind, why: null, quote: '', sourceRef: { raw_content_id: i.evidence[0] ?? '' } })),
    ],
    dropped: written.cut.length,
  };

  let saved = false;
  if (!deps.dryRun) {
    const { error } = await db.from(Tables.DAILY_BRIEFS).upsert({
      user_id: userId, brief_date: briefDate, kind: brief.kind, through_line: brief.throughLine,
      spine_question_id: null, spine_movement: 'planner v2', items: brief.items, dropped: brief.dropped,
      model_version: config.anthropic.writerModel, cost_usd: costUsd,
    }, { onConflict: 'user_id,brief_date' });
    if (error) throw new Error(`Could not save the brief: ${error.message}`);
    saved = true;
  }
  return { brief: brief as BriefRun['brief'], briefDate, costUsd, cost: costLines(breakdown as never), materialCount: plan.inbox.length, saved };
}
