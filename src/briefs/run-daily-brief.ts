/**
 * Making one person's daily brief: gather what is new since their last brief
 * and which answers moved, ask the model, keep only what is grounded, save.
 * The judgement lives in daily-brief.ts; this is the plumbing.
 */

import { dailyV2For, runDailyBriefV2 } from './run-daily-brief-v2';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { costLines, estimateCostUsd, type CostLine } from '../pipelines/trace';
import { OWN_WORDS_CONTENT_TYPES } from '../questions/first-pass';
import { distinctEvents } from '../questions/run-first-pass';
import {
  DAILY_BRIEF_SYSTEM, buildBriefPrompt, vetBrief, quietBrief,
  type BriefAnswer, type BriefMaterial, type VettedBrief,
} from './daily-brief';

export const MATERIAL_LIMIT = 25;
const ITEM_CHARS = 1_500;
const MOVED = ['strengthened', 'weakened', 'revised', 'first_answer'];

export type BriefModel = (system: string, user: string) => Promise<{ data: Record<string, unknown>; usage: ClaudeUsage }>;

export interface BriefRun {
  brief: VettedBrief;
  briefDate: string;
  costUsd: number;
  cost: CostLine[];
  materialCount: number;
  saved: boolean;
}

/** Everything new since `since`: their own words first, then calendar and mail. */
export async function loadBriefMaterial(userId: string, since: string, db: typeof supabase = supabase): Promise<BriefMaterial[]> {
  const { data } = await db.from(Tables.RAW_CONTENT)
    .select('id,content_type,content,content_date,created_at,authorship')
    .eq('user_id', userId).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(300);
  const rows = (data ?? []) as Array<{ id: string; content_type: string; content: string | null; content_date: string | null; created_at: string; authorship?: string | null }>;
  const ownWords = rows.filter((r) => OWN_WORDS_CONTENT_TYPES.has(r.content_type) && r.content_type !== 'onboarding_profile' && (r.authorship ?? 'self') === 'self');
  const calendar = distinctEvents(rows.filter((r) => r.content_type === 'calendar'), 10);
  const mail = rows.filter((r) => r.content_type === 'gmail').slice(0, 8);
  return [...ownWords, ...calendar, ...mail]
    .filter((r) => (r.content ?? '').trim().length > 0)
    .slice(0, MATERIAL_LIMIT)
    .map((r, i) => ({
      handle: `M${i + 1}`,
      label: `${r.content_type.replace(/_/g, ' ')} · ${new Date(r.content_date ?? r.created_at).toISOString().slice(0, 10)}`,
      text: String(r.content).slice(0, ITEM_CHARS),
      quotable: String(r.content),
      sourceRef: { raw_content_id: r.id },
    }));
}

/** Their current answers, marked with how each moved since `since`. */
export async function loadBriefAnswers(userId: string, since: string, db: typeof supabase = supabase): Promise<BriefAnswer[]> {
  const [{ data: answers }, { data: questions }, { data: log }] = await Promise.all([
    db.from(Tables.CURRENT_ANSWERS).select('question_id,answer,confidence').eq('user_id', userId),
    db.from(Tables.CANONICAL_QUESTIONS).select('id,text'),
    db.from(Tables.QUESTION_RESEARCH_LOG).select('question_id,outcome,researched_at')
      .eq('user_id', userId).gte('researched_at', since).in('outcome', MOVED)
      .order('researched_at', { ascending: false }),
  ]);
  const text = new Map(((questions ?? []) as Array<{ id: number; text: string }>).map((q) => [q.id, q.text]));
  const moved = new Map<number, BriefAnswer['movedSince']>();
  for (const l of (log ?? []) as Array<{ question_id: number; outcome: string }>) {
    if (!moved.has(l.question_id)) moved.set(l.question_id, l.outcome as BriefAnswer['movedSince']);
  }
  return ((answers ?? []) as Array<{ question_id: number; answer: string; confidence: number }>)
    .sort((a, b) => a.question_id - b.question_id)
    .map((a) => ({
      questionId: a.question_id,
      question: text.get(a.question_id) ?? '',
      answer: a.answer,
      confidence: Number(a.confidence),
      ...(moved.get(a.question_id) ? { movedSince: moved.get(a.question_id) } : {}),
    }));
}

/** When the last brief from an EARLIER day was made. A re-run today looks at the
 *  same window as today's first run, so it can't overwrite a real brief with a
 *  quiet one. */
async function lastBriefAt(userId: string, briefDate: string, db: typeof supabase): Promise<string | null> {
  const { data } = await db.from(Tables.DAILY_BRIEFS).select('created_at').eq('user_id', userId)
    .lt('brief_date', briefDate)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const at = (data as { created_at?: string | Date } | null)?.created_at;
  return at ? new Date(at).toISOString() : null;
}

export async function runDailyBrief(
  userId: string,
  deps: { db?: typeof supabase; model?: BriefModel; modelName?: string; now?: Date; dryRun?: boolean } = {},
): Promise<BriefRun> {
  // D1.4: the new daily path, per person, off by default.
  if (dailyV2For(userId)) return runDailyBriefV2(userId, { db: deps.db, now: deps.now, dryRun: deps.dryRun });
  const db = deps.db ?? supabase;
  const now = deps.now ?? new Date();
  const modelName = deps.modelName ?? config.anthropic.questionsModel;
  const model: BriefModel = deps.model
    ?? ((system, user) => claudeJsonCompletion<Record<string, unknown>>(system, user, { model: modelName, maxTokens: 3000 }));
  const briefDate = now.toISOString().slice(0, 10);
  const since = (await lastBriefAt(userId, briefDate, db)) ?? new Date(now.getTime() - 24 * 3600_000).toISOString();

  const [material, answers] = await Promise.all([loadBriefMaterial(userId, since, db), loadBriefAnswers(userId, since, db)]);

  let brief: VettedBrief;
  let usage: ClaudeUsage = { inputTokens: 0, outputTokens: 0 };
  // Nothing new and nothing moved: a quiet brief, with no model call at all.
  if (material.length === 0 && !answers.some((a) => a.movedSince)) {
    brief = quietBrief();
  } else {
    const res = await model(DAILY_BRIEF_SYSTEM, buildBriefPrompt(answers, material));
    usage = res.usage;
    brief = vetBrief(res.data, material, answers);
  }

  const breakdown = {
    openai_tokens_input: 0, openai_tokens_output: 0,
    anthropic_tokens_input: usage.inputTokens, anthropic_tokens_output: usage.outputTokens,
    embedding_tokens: 0, perplexity_calls: 0, elevenlabs_chars: 0, est_usd: 0,
    by_model: usage.inputTokens ? { [modelName]: { input: usage.inputTokens, output: usage.outputTokens, calls: 1 } } : {},
  };
  const costUsd = estimateCostUsd(breakdown as any).usd;

  let saved = false;
  if (!deps.dryRun) {
    const { error } = await db.from(Tables.DAILY_BRIEFS).upsert({
      user_id: userId,
      brief_date: briefDate,
      kind: brief.kind,
      through_line: brief.throughLine,
      spine_question_id: brief.spineQuestionId,
      spine_movement: brief.spineMovement,
      items: brief.items,
      dropped: brief.dropped,
      model_version: usage.inputTokens ? modelName : null,
      cost_usd: costUsd,
    }, { onConflict: 'user_id,brief_date' });
    if (error) throw new Error(`Could not save the brief: ${error.message}`);
    saved = true;
  }
  return { brief, briefDate, costUsd, cost: costLines(breakdown as any), materialCount: material.length, saved };
}
