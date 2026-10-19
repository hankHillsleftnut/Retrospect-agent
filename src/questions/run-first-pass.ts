/**
 * Plumbing for the first pass: gather what is on record, ask the model one
 * domain at a time, vet what comes back (first-pass.ts), and save each
 * surviving guess through record_answer() -- the database's one way in.
 *
 * Run it once a person has finished onboarding and connected their sources.
 * Safe to run again: each question has one first-pass derivation, so a re-run
 * updates the guess rather than adding another.
 */

import { createHash } from 'node:crypto';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { estimateCostUsd } from '../pipelines/trace';
import { isHealthSummary, normalizeHealthSummary } from '../pipelines/health-summary';
import {
  FIRST_PASS_SYSTEM, OWN_WORDS_CONTENT_TYPES, buildFirstPassPrompt, firstPassDerivationKey, vetFirstPass,
  type Outcome, type PoolItem, type Question,
} from './first-pass';

/** How much is put in front of the model. Newest first within each group. */
export const POOL_LIMITS = { ownWords: 60, facts: 80, patterns: 30, recordsPerType: 8 };
/** A piece of writing shorter than this says too little to cite. */
const MIN_WORDS_CHARS = 20;

export type FirstPassModel = (system: string, user: string) => Promise<{ data: { answers?: unknown }; usage: ClaudeUsage }>;

export interface FirstPassDeps {
  db?: typeof supabase;
  model?: FirstPassModel;
  modelName?: string;
  /** Vet and report, but save nothing. For reading the guesses before trusting them. */
  dryRun?: boolean;
}

export interface FirstPassReport {
  userId: string;
  poolSize: number;
  guessed: number;
  recorded: number;
  refusedByDatabase: { questionId: number; reason: string }[];
  byStatus: Record<Outcome['status'], number>;
  outcomes: Outcome[];
  costUsd: number;
}

export async function runFirstPass(userId: string, deps: FirstPassDeps = {}): Promise<FirstPassReport> {
  const db = deps.db ?? supabase;
  const modelName = deps.modelName ?? config.anthropic.questionsModel;
  const model: FirstPassModel = deps.model
    ?? ((system, user) => claudeJsonCompletion<{ answers?: unknown }>(system, user, { maxTokens: 6000, model: modelName }));

  const [questions, domains] = await Promise.all([loadQuestions(db), loadDomains(db)]);
  const pool = await buildPool(userId, db);

  const outcomes: Outcome[] = [];
  const refusedByDatabase: FirstPassReport['refusedByDatabase'] = [];
  let recorded = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const domain of domains) {
    const inDomain = questions.filter((q) => q.domainId === domain.id);
    const askable = inDomain.filter((q) => !q.hypothesisOnly);
    let reply: { answers?: unknown } = { answers: [] };
    if (askable.length > 0 && pool.length > 0) {
      try {
        const res = await model(FIRST_PASS_SYSTEM, buildFirstPassPrompt(domain.label, askable, pool));
        reply = res.data;
        inputTokens += res.usage.inputTokens;
        outputTokens += res.usage.outputTokens;
      } catch (err) {
        // One domain failing must not cost the others. Its questions report as
        // not_returned and the next run tries again.
        console.warn(`[first-pass] ${domain.id} failed for ${userId}: ${(err as Error).message}`);
      }
    }

    for (const outcome of vetFirstPass(inDomain, pool, reply)) {
      outcomes.push(outcome);
      if (outcome.status !== 'guessed' || deps.dryRun) continue;
      const { error } = await db.rpc('record_answer', {
        p: {
          user_id: userId,
          question_id: outcome.guess.questionId,
          answer: outcome.guess.answer,
          derived_by: 'first_pass',
          derivation_key: firstPassDerivationKey(outcome.guess.questionId),
          model_version: modelName,
          evidence: outcome.guess.evidence,
        },
      });
      if (error) refusedByDatabase.push({ questionId: outcome.questionId, reason: error.message });
      else recorded += 1;
    }
  }

  const byStatus = { guessed: 0, no_basis: 0, gated: 0, unsupported: 0, not_returned: 0 } as FirstPassReport['byStatus'];
  for (const o of outcomes) byStatus[o.status] += 1;

  return {
    userId,
    poolSize: pool.length,
    guessed: byStatus.guessed,
    recorded,
    refusedByDatabase,
    byStatus,
    outcomes,
    costUsd: estimateCostUsd({
      openai_tokens_input: 0, openai_tokens_output: 0,
      anthropic_tokens_input: inputTokens, anthropic_tokens_output: outputTokens,
      embedding_tokens: 0, perplexity_calls: 0, elevenlabs_chars: 0, est_usd: 0,
      by_model: { [modelName]: { input: inputTokens, output: outputTokens } },
    }).usd,
  };
}

// ── Loading ─────────────────────────────────────────────────────────────────

export async function loadQuestions(db: typeof supabase): Promise<Question[]> {
  const { data, error } = await db.from(Tables.CANONICAL_QUESTIONS)
    .select('id,domain_id,text,requires_own_words,hypothesis_only').order('id');
  if (error) throw new Error(`first pass: could not load questions: ${error.message}`);
  return (data ?? []).map((q: any) => ({
    id: q.id, domainId: q.domain_id, text: q.text,
    requiresOwnWords: q.requires_own_words, hypothesisOnly: q.hypothesis_only,
  }));
}

export async function loadDomains(db: typeof supabase): Promise<{ id: string; label: string }[]> {
  const { data, error } = await db.from(Tables.QUESTION_DOMAINS).select('id,label').order('position');
  if (error) throw new Error(`first pass: could not load domains: ${error.message}`);
  return data ?? [];
}

/**
 * Everything the model may cite, with short handles. Copies of one upload
 * appear once: the database counts them once, so showing five copies would
 * only invite the model to cite the same thing five times.
 */
export async function buildPool(userId: string, db: typeof supabase, since?: string): Promise<PoolItem[]> {
  const pool: PoolItem[] = [];
  const add = (item: Omit<PoolItem, 'handle'>) => pool.push({ ...item, handle: `E${pool.length + 1}` });
  const day = (iso: string | null | undefined) => (iso ?? '').slice(0, 10);
  // With `since`, only what arrived after it: the researcher's "what's new".
  const after = (q: any, column: string) => (since ? q.gt(column, since) : q);

  // Their own words: the richest evidence there is.
  const { data: words } = await after(db.from(Tables.RAW_CONTENT)
    .select('id,content_type,content,content_date,created_at')
    .eq('user_id', userId).in('content_type', [...OWN_WORDS_CONTENT_TYPES]), 'created_at')
    .order('created_at', { ascending: false }).limit(POOL_LIMITS.ownWords * 4);
  const seen = new Set<string>();
  for (const r of (words ?? []) as any[]) {
    const text = String(r.content ?? '');
    const key = createHash('sha256').update(text).digest('hex');
    if (text.trim().length < MIN_WORDS_CHARS || seen.has(key)) continue;
    seen.add(key);
    add({
      ref: { raw_content_id: r.id }, ownWords: true,
      label: `${r.content_type.replace(/_/g, ' ')} · ${day(r.content_date ?? r.created_at)}`,
      text, quotable: text, at: r.created_at,
    });
    if (seen.size >= POOL_LIMITS.ownWords) break;
  }

  // Facts already extracted and verified.
  const { data: facts } = await after(db.from(Tables.ASSERTIONS)
    .select('id,predicate,object_value,event_time,observed_at,created_at,metadata')
    .eq('user_id', userId).eq('status', 'active'), 'created_at')
    .order('observed_at', { ascending: false }).limit(POOL_LIMITS.facts);
  for (const f of (facts ?? []) as any[]) {
    const object = f.object_value?.normalized ?? f.object_value?.label ?? JSON.stringify(f.object_value ?? {}).slice(0, 200);
    const contentType = String(f.metadata?.content_type ?? '');
    add({
      ref: { assertion_id: f.id }, ownWords: OWN_WORDS_CONTENT_TYPES.has(contentType),
      label: `fact${contentType ? ` from ${contentType.replace(/_/g, ' ')}` : ''} · ${day(f.event_time ?? f.observed_at)}`,
      text: `${String(f.predicate).replace(/_/g, ' ')}: ${object}`,
      at: f.created_at,
    });
  }

  // Patterns that have earned "live".
  const { data: patterns } = await after(db.from(Tables.BEHAVIOR_PATTERNS)
    .select('id,label,instance_count,first_seen_at,last_seen_at,updated_at')
    .eq('user_id', userId).eq('status', 'live'), 'updated_at').limit(POOL_LIMITS.patterns);
  for (const b of (patterns ?? []) as any[]) {
    add({
      ref: { pattern_id: b.id }, ownWords: false,
      label: `pattern · seen ${b.instance_count} times, ${day(b.first_seen_at)} to ${day(b.last_seen_at)}`,
      text: b.label,
      at: b.updated_at,
    });
  }

  // A few recent records of each other kind, so record-based questions have
  // something to work with. Health readings are cleaned so a zero reads as
  // "not recorded" -- the lesson of the false sleep claims.
  for (const type of ['calendar', 'screen_time', 'healthkit']) {
    const { data: records } = await after(db.from(Tables.RAW_CONTENT)
      .select('id,content_type,content,content_date,created_at')
      .eq('user_id', userId).eq('content_type', type), 'created_at')
      .order('created_at', { ascending: false }).limit(POOL_LIMITS.recordsPerType);
    for (const r of (records ?? []) as any[]) {
      const text = isHealthSummary(r.content_type) ? normalizeHealthSummary(r.content) : String(r.content ?? '');
      add({
        ref: { raw_content_id: r.id }, ownWords: false,
        label: `${type.replace(/_/g, ' ')} · ${day(r.content_date ?? r.created_at)}`,
        text,
        at: r.created_at,
      });
    }
  }

  return pool;
}
