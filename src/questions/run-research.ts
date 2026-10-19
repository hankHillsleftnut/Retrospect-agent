/**
 * Plumbing for the ambient researcher (research.ts holds the judgment).
 *
 * For one person: find what is new per question, research the few questions
 * where that matters most, save what survives through record_answer(), and log
 * every look -- including "unchanged" -- so the next run starts after it.
 *
 * Meant to run daily, after ingestion has turned the day's material into
 * facts. Off unless ENABLE_QUESTION_RESEARCH is set; see src/index.ts.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { estimateCostUsd } from '../pipelines/trace';
import { buildPool, loadQuestions } from './run-first-pass';
import type { PoolItem } from './first-pass';
import {
  RESEARCH_BUDGET, RESEARCH_SYSTEM, buildResearchPrompt, rankNewItems, mergeEvidence, pickQuestions, researchDerivationKey,
  researchPool, vetResearch, type CurrentAnswer, type QuestionState, type ResearchAction,
} from './research';

/** New items shown per question, newest first. Bounds the cost of one look. */
export const NEW_ITEMS_PER_QUESTION = 40;

export type ResearchModel = (system: string, user: string) => Promise<{ data: Record<string, unknown>; usage: ClaudeUsage }>;

export interface ResearchDeps {
  db?: typeof supabase;
  model?: ResearchModel;
  modelName?: string;
  budget?: number;
  now?: () => Date;
  /** Look again at everything since this time, whatever was read before. One-off use. */
  rereadSince?: string;
}

/**
 * How far a look counts as having read. Everything up to the newest item shown --
 * unless some new items were not shown (more than fit), in which case only up to
 * just before the earliest unshown one, so they are shown next time instead of
 * being skipped for good (found 19 October 2026: a whole calendar arriving in
 * the same minute as a YouTube history was marked read without being seen).
 */
export function readUpTo(shown: Array<{ at?: string }>, unshownEarliest: string | null, now: Date): string {
  const newestShown = shown.reduce((max, i) => (i.at && i.at > max ? i.at : max), '') || now.toISOString();
  if (!unshownEarliest) return newestShown;
  const justBefore = new Date(new Date(unshownEarliest).getTime() - 1).toISOString();
  return justBefore < newestShown ? justBefore : newestShown;
}

export interface ResearchEntry {
  questionId: number;
  outcome: string;
  itemsRead: number;
  detail?: string;
}

export async function runResearch(userId: string, deps: ResearchDeps = {}): Promise<{ researched: ResearchEntry[]; costUsd: number }> {
  const db = deps.db ?? supabase;
  const modelName = deps.modelName ?? config.anthropic.questionsModel;
  const model: ResearchModel = deps.model
    ?? ((system, user) => claudeJsonCompletion<Record<string, unknown>>(system, user, { maxTokens: 2000, model: modelName }));
  const now = deps.now ?? (() => new Date());

  const states = await loadStates(userId, db, deps.rereadSince);
  const picked = pickQuestions(states, deps.budget ?? RESEARCH_BUDGET);
  const researched: ResearchEntry[] = [];
  let costUsd = 0;

  for (const state of picked) {
    const pool = researchPool(state);
    const shownNew = state.newItems;
    const materialUntil = readUpTo(shownNew, state.unshownEarliest, now());
    let action: ResearchAction | { kind: 'failed'; detail: string };
    let cost = 0;

    try {
      const res = await model(RESEARCH_SYSTEM, buildResearchPrompt(state, pool));
      cost = priced(modelName, res.usage);
      action = vetResearch(state, pool, res.data);
    } catch (err) {
      action = { kind: 'failed', detail: (err as Error).message.slice(0, 300) };
    }
    costUsd += cost;

    const { outcome, answerId, detail } = await apply(userId, state, action, modelName, db);
    researched.push({ questionId: state.question.id, outcome, itemsRead: shownNew.length, ...(detail ? { detail } : {}) });

    // A failed look is logged but does not advance material_until, so the same
    // material is looked at again next time.
    const { error } = await db.from(Tables.QUESTION_RESEARCH_LOG).insert({
      user_id: userId,
      question_id: state.question.id,
      material_until: outcome === 'failed' ? (state.since ?? new Date(0).toISOString()) : materialUntil,
      items_read: shownNew.length,
      outcome,
      answer_id: answerId,
      detail: detail ?? null,
      cost_usd: cost,
    });
    if (error) console.warn(`[research] could not log Q${state.question.id} for ${userId}: ${error.message}`);
  }

  return { researched, costUsd };
}

async function apply(
  userId: string,
  state: QuestionState & { since?: string | null },
  action: ResearchAction | { kind: 'failed'; detail: string },
  modelName: string,
  db: typeof supabase,
): Promise<{ outcome: string; answerId: string | null; detail?: string }> {
  const current = state.current;
  switch (action.kind) {
    case 'failed':
      return { outcome: 'failed', answerId: current?.answerId ?? null, detail: action.detail };
    case 'unchanged':
    case 'no_basis':
    case 'unsupported':
      return { outcome: action.kind, answerId: current?.answerId ?? null, detail: droppedDetail(action.dropped) };
    case 'update': {
      // Same derivation, same words; more (or contrary) evidence. The database
      // recomputes confidence from it.
      const { error } = await db.rpc('record_answer', {
        p: {
          user_id: userId, question_id: state.question.id, answer: current!.answer,
          derived_by: current!.derivedBy, derivation_key: current!.derivationKey, model_version: modelName,
          evidence: mergeEvidence(current!, action.add),
        },
      });
      return error
        ? { outcome: 'refused', answerId: current!.answerId, detail: error.message }
        : { outcome: action.outcome, answerId: current!.answerId, detail: droppedDetail(action.dropped) };
    }
    case 'revise':
    case 'first_answer': {
      const { data, error } = await db.rpc('record_answer', {
        p: {
          user_id: userId, question_id: state.question.id, answer: action.answer,
          derived_by: 'researcher', derivation_key: researchDerivationKey(state.question.id, action.answer),
          model_version: modelName, evidence: action.evidence,
        },
      });
      return error
        ? { outcome: 'refused', answerId: current?.answerId ?? null, detail: error.message }
        : { outcome: action.kind === 'revise' ? 'revised' : 'first_answer', answerId: data as string, detail: droppedDetail(action.dropped) };
    }
  }
}

function droppedDetail(dropped: { handle: string; reason: string }[]): string | undefined {
  return dropped.length ? `dropped ${dropped.map((d) => `${d.handle} (${d.reason})`).join(', ')}` : undefined;
}

function priced(model: string, usage: ClaudeUsage): number {
  return estimateCostUsd({
    openai_tokens_input: 0, openai_tokens_output: 0,
    anthropic_tokens_input: usage.inputTokens, anthropic_tokens_output: usage.outputTokens,
    embedding_tokens: 0, perplexity_calls: 0, elevenlabs_chars: 0, est_usd: 0,
    by_model: { [model]: { input: usage.inputTokens, output: usage.outputTokens } },
  }).usd;
}

// ── Loading ─────────────────────────────────────────────────────────────────

/** Every question's state for one person: current answer, its evidence, what is new. */
export async function loadStates(
  userId: string,
  db: typeof supabase,
  rereadSince?: string,
): Promise<Array<QuestionState & { since: string | null; unshownEarliest: string | null }>> {
  const questions = await loadQuestions(db);

  const [{ data: domains }, { data: current }, { data: log }] = await Promise.all([
    db.from(Tables.QUESTION_DOMAINS).select('id,confidence_floor'),
    db.from(Tables.CURRENT_ANSWERS).select('question_id,answer_id,answer,confidence,competing_answers').eq('user_id', userId),
    db.from(Tables.QUESTION_RESEARCH_LOG).select('question_id,material_until')
      .eq('user_id', userId).order('researched_at', { ascending: false }).limit(500),
  ]);
  const floor = new Map((domains ?? []).map((d: any) => [d.id, Number(d.confidence_floor)]));
  const since = new Map<number, string>();
  for (const l of (log ?? []) as any[]) if (!since.has(l.question_id)) since.set(l.question_id, l.material_until);
  if (rereadSince) for (const q of questions) since.set(q.id, rereadSince);

  const answers = await loadCurrentAnswers(db, (current ?? []) as any[]);

  // One read of new material, from the earliest point any question needs.
  const sinces = questions.map((q) => since.get(q.id) ?? null);
  const earliest = sinces.includes(null) ? undefined : sinces.reduce((a, b) => (a! < b! ? a : b))!;
  const material = await buildPool(userId, db, earliest);

  return questions.map((q) => {
    const s = since.get(q.id) ?? null;
    const cited = new Set((answers.get(q.id)?.evidence ?? []).map((e) => JSON.stringify(e.ref)));
    const candidates = material.filter((i) => (!s || (i.at ?? '') > s) && !cited.has(JSON.stringify(i.ref)));
    const newItems = rankNewItems(candidates, q.answerableFrom, NEW_ITEMS_PER_QUESTION);
    const shownSet = new Set(newItems);
    const unshownEarliest = candidates
      .filter((i) => !shownSet.has(i) && i.at)
      .reduce<string | null>((min, i) => (min === null || i.at! < min ? i.at! : min), null);
    const row = ((current ?? []) as any[]).find((c) => c.question_id === q.id);
    return {
      question: q,
      floor: floor.get(q.domainId) ?? 0.5,
      current: answers.get(q.id) ?? null,
      competing: Number(row?.competing_answers ?? 0),
      newItems,
      since: s,
      unshownEarliest,
    };
  });
}

/** The current answers with their evidence turned back into items the model can read and re-cite. */
async function loadCurrentAnswers(db: typeof supabase, rows: any[]): Promise<Map<number, CurrentAnswer>> {
  const out = new Map<number, CurrentAnswer>();
  if (rows.length === 0) return out;
  const ids = rows.map((r) => r.answer_id);

  const [{ data: meta }, { data: evidence }, { data: kinds }] = await Promise.all([
    db.from(Tables.QUESTION_ANSWERS).select('id,derivation_key,derived_by').in('id', ids),
    db.from(Tables.ANSWER_EVIDENCE)
      .select('answer_id,stance,assertion_id,pattern_id,raw_content_id,kind_id,excerpt,observed_at').in('answer_id', ids),
    db.from(Tables.EVIDENCE_KINDS).select('id,label,own_words'),
  ]);
  const kindOf = new Map((kinds ?? []).map((k: any) => [k.id, k]));
  const ev = (evidence ?? []) as any[];

  const texts = new Map<string, string>();
  const rawIds = ev.map((e) => e.raw_content_id).filter(Boolean);
  const factIds = ev.map((e) => e.assertion_id).filter(Boolean);
  const patternIds = ev.map((e) => e.pattern_id).filter(Boolean);
  if (rawIds.length) {
    const { data } = await db.from(Tables.RAW_CONTENT).select('id,content').in('id', rawIds);
    for (const r of (data ?? []) as any[]) texts.set(r.id, String(r.content ?? ''));
  }
  if (factIds.length) {
    const { data } = await db.from(Tables.ASSERTIONS).select('id,predicate,object_value').in('id', factIds);
    for (const f of (data ?? []) as any[]) texts.set(f.id, `${String(f.predicate).replace(/_/g, ' ')}: ${f.object_value?.normalized ?? ''}`);
  }
  if (patternIds.length) {
    const { data } = await db.from(Tables.BEHAVIOR_PATTERNS).select('id,label').in('id', patternIds);
    for (const p of (data ?? []) as any[]) texts.set(p.id, p.label);
  }

  for (const r of rows) {
    const m = ((meta ?? []) as any[]).find((x) => x.id === r.answer_id);
    if (!m) continue;
    out.set(r.question_id, {
      answerId: r.answer_id,
      derivationKey: m.derivation_key,
      derivedBy: m.derived_by,
      answer: r.answer,
      confidence: Number(r.confidence),
      evidence: ev.filter((e) => e.answer_id === r.answer_id).map((e) => {
        const id = e.raw_content_id ?? e.assertion_id ?? e.pattern_id;
        const ref = e.raw_content_id ? { raw_content_id: id } : e.assertion_id ? { assertion_id: id } : { pattern_id: id };
        const kind = kindOf.get(e.kind_id) as any;
        const text = texts.get(id) ?? e.excerpt ?? '';
        const item: PoolItem = {
          handle: '', ref, ownWords: Boolean(kind?.own_words),
          label: `${kind?.label ?? e.kind_id} · ${String(e.observed_at ?? '').slice(0, 10)}`,
          text,
          ...(e.raw_content_id && kind?.own_words ? { quotable: text } : {}),
        };
        return { ...item, stance: e.stance, excerpt: e.excerpt };
      }),
    });
  }
  return out;
}
