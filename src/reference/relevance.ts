/**
 * What a saved link bears on (R1.3, goal 11: "every brought item traces to a
 * question your own life raised"). A small model judges each enriched link
 * against the person's active goals and the canonical questions, with "none"
 * allowed; answers are vetted to real ids. Similarity can't do this: a goal
 * sentence and a page summary are different kinds of text (findings #34).
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';

export const RELEVANCE_SYSTEM = `Someone saved links, each with their own reason. Decide which of their GOALS and QUESTIONS each link clearly bears on.
Only link when it plainly helps with that goal or speaks to that question. When unsure, leave it out; an empty list is fine.
Reply with JSON only: {"links":[{"i":<link number>,"goals":[<goal numbers>],"questions":[<question numbers>]}]}`;

export interface RelItem { id: string; intent: string | null; title: string | null; summary: string | null }

export function relevancePrompt(items: RelItem[], goals: Array<{ id: string; title: string }>, questions: Array<{ id: number; text: string }>): string {
  return [
    `GOALS\n${goals.map((g, i) => `${i}: ${g.title}`).join('\n') || '(none)'}`,
    `QUESTIONS\n${questions.map((q) => `${q.id}: ${q.text}`).join('\n')}`,
    `LINKS\n${items.map((it, i) => `${i}: ${it.title ?? '(untitled)'}. ${it.summary ?? ''}${it.intent ? ` Their reason: "${it.intent}"` : ''}`).join('\n')}`,
  ].join('\n\n');
}

/** Keep only real goals and questions. Pure. */
export function vetRelevance(reply: { links?: Array<{ i?: unknown; goals?: unknown; questions?: unknown }> }, items: RelItem[], goals: Array<{ id: string }>, questionIds: Set<number>) {
  const out = new Map<string, { goalIds: string[]; questionIds: number[] }>(items.map((it) => [it.id, { goalIds: [], questionIds: [] }]));
  for (const l of reply.links ?? []) {
    const it = items[Number(l.i)];
    if (!it) continue;
    const g = Array.isArray(l.goals) ? l.goals.map(Number).filter((n) => Number.isInteger(n) && goals[n]).map((n) => goals[n]!.id) : [];
    const q = Array.isArray(l.questions) ? l.questions.map(Number).filter((n) => questionIds.has(n)) : [];
    out.set(it.id, { goalIds: [...new Set(g)], questionIds: [...new Set(q)] });
  }
  return out;
}

export async function relatePending(userId: string, options: { db?: typeof supabase; model?: (s: string, p: string) => Promise<{ data: { links?: Array<{ i?: unknown; goals?: unknown; questions?: unknown }> }; usage: ClaudeUsage }> } = {}) {
  const db = options.db ?? supabase;
  const { data: rows } = await db.from(Tables.REFERENCE_ITEMS).select('id,intent,title,summary').eq('user_id', userId).eq('status', 'enriched').is('related_at', null).limit(40);
  const items = (rows ?? []) as RelItem[];
  if (!items.length) return { related: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  const [{ data: goals }, { data: questions }] = await Promise.all([
    db.from(Tables.GOALS).select('id,title').eq('user_id', userId).eq('status', 'active'),
    db.from(Tables.CANONICAL_QUESTIONS).select('id,text'),
  ]);
  const g = (goals ?? []) as Array<{ id: string; title: string }>, q = (questions ?? []) as Array<{ id: number; text: string }>;
  const model = options.model ?? ((s, p) => claudeJsonCompletion<{ links?: Array<{ i?: unknown; goals?: unknown; questions?: unknown }> }>(s, p, { model: config.anthropic.timeCategoryModel, maxTokens: 2000 }));
  const { data, usage } = await model(RELEVANCE_SYSTEM, relevancePrompt(items, g, q));
  const vetted = vetRelevance(data, items, g, new Set(q.map((x) => x.id)));
  const at = new Date().toISOString();
  for (const [id, v] of vetted) await db.from(Tables.REFERENCE_ITEMS).update({ goal_ids: v.goalIds, question_ids: v.questionIds, related_at: at }).eq('id', id);
  return { related: vetted.size, usage };
}
