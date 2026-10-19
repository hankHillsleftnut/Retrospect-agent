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
import { splitIntoSections } from '../text/sections';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { costLines, estimateCostUsd, type CostLine } from '../pipelines/trace';
import { isHealthSummary, recordedReadingsOnly } from '../pipelines/health-summary';
import {
  FIRST_PASS_SYSTEM, OWN_WORDS_CONTENT_TYPES, buildFirstPassPrompt, firstPassDerivationKey, vetFirstPass,
  type Outcome, type PoolItem, type Question,
} from './first-pass';

/** How much is put in front of the model. Newest first within each group. */
export const POOL_LIMITS = {
  /** Journal entries, voice notes, text entries: the most candid words there are. */
  personalWriting: 45,
  /** Characters of personal writing shown in total, newest first. */
  personalWritingChars: 60_000,
  /** Onboarding is one profile, often re-uploaded; the latest copy says it all. */
  onboarding: 1,
  /** Document sections, spread across documents. */
  documentSections: 14,
  facts: 80,
  patterns: 30,
  recordsPerType: 8,
  /** Calendar and mail are where the week and the people are; 8 hid most of a
   *  calendar (19 October 2026). Each entry is short. */
  recordsPerTypeWeekAndPeople: 40,
};

const PERSONAL_WRITING_TYPES = ['journal_entry', 'voice_journal', 'voice_recording', 'text_entry', 'video_entry', 'conversation'];
/** Long writing is shown in sections of about this many characters. */
export const SECTION_CHARS = 1_200;

export { splitIntoSections } from '../text/sections';

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
  /** Where the money went: provider, model, calls, tokens, price. */
  cost: CostLine[];
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
  let calls = 0;

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
        calls += 1;
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
    ...(() => {
      const breakdown = {
        openai_tokens_input: 0, openai_tokens_output: 0,
        anthropic_tokens_input: inputTokens, anthropic_tokens_output: outputTokens,
        embedding_tokens: 0, perplexity_calls: 0, elevenlabs_chars: 0, est_usd: 0,
        by_model: { [modelName]: { input: inputTokens, output: outputTokens, calls } },
      };
      return { costUsd: estimateCostUsd(breakdown).usd, cost: costLines(breakdown) };
    })(),
  };
}

// ── Loading ─────────────────────────────────────────────────────────────────

export async function loadQuestions(db: typeof supabase): Promise<Question[]> {
  const { data, error } = await db.from(Tables.CANONICAL_QUESTIONS)
    .select('id,domain_id,text,requires_own_words,hypothesis_only,answerable_from').order('id');
  if (error) throw new Error(`first pass: could not load questions: ${error.message}`);
  return (data ?? []).map((q: any) => ({
    id: q.id, domainId: q.domain_id, text: q.text,
    requiresOwnWords: q.requires_own_words, hypothesisOnly: q.hypothesis_only,
    answerableFrom: q.answerable_from ?? [],
  }));
}

/**
 * One entry per distinct calendar event title, newest kept, with how many times
 * it occurs. A weekly block shown 15 times crowded every meeting with a person
 * out of what "who you spend time with" could see (19 October 2026).
 */
export function distinctEvents<T extends { content?: string | null }>(rows: T[], limit: number): Array<T & { repeats: number }> {
  const byTitle = new Map<string, { row: T; repeats: number }>();
  for (const r of rows) {
    const title = String(r.content ?? '').split('\n')[0]!.trim().toLowerCase();
    const seen = byTitle.get(title);
    if (seen) seen.repeats += 1;
    else byTitle.set(title, { row: r, repeats: 1 });
  }
  return [...byTitle.values()].slice(0, limit).map(({ row, repeats }) => ({ ...row, repeats }));
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
  //
  // Drawn by kind, each with its own share. Taking "the newest N" across all
  // kinds let one source crowd out the rest: in the first dry run (18 October
  // 2026), 1,357 rows of four Google Docs -- chunked, and re-synced again and
  // again -- left room for almost none of the founder's 65 text entries and 13
  // voice notes. Copies are dropped by content, and a document counts once per
  // section however many times it was synced.
  const seen = new Set<string>();
  const addWords = (r: any, label: string, budget?: { chars: number }) => {
    const text = String(r.content ?? '');
    const key = createHash('sha256').update(text).digest('hex');
    if (text.trim().length < MIN_WORDS_CHARS || seen.has(key)) return false;
    if (budget && budget.chars <= 0) return false;
    seen.add(key);
    // Whose words these are (migration 115). A document in their Drive may be
    // someone else's -- a hiring post, a company's brief -- so only 'self'
    // counts as their voice. No authorship recorded keeps the old behaviour.
    const theirs = r.authorship ? r.authorship === 'self' : true;
    // Long writing is shown in sections, each in full. The model is shown at
    // most ITEM_PREVIEW_CHARS of any one item, so a 36,000-character
    // conversation shown whole was 98% unread (found 18 October 2026). Every
    // section is checked against the full text, so quotes still verify.
    const sections = splitIntoSections(text, SECTION_CHARS);
    sections.forEach((section, i) => {
      if (budget && budget.chars <= 0) return;
      if (budget) budget.chars -= section.length;
      add({
        ref: { raw_content_id: r.id }, ownWords: theirs,
        label: `${label}${theirs ? '' : ' (author not known to be them)'}${sections.length > 1 ? ` (part ${i + 1} of ${sections.length})` : ''} · ${day(r.content_date ?? r.created_at)}`,
        text: section, quotable: text, at: r.created_at, contentType: r.content_type,
      });
    });
    return true;
  };
  const wordsOf = async (types: string[], limit: number) => {
    const { data } = await after(db.from(Tables.RAW_CONTENT)
      .select('id,content_type,content,content_date,created_at,metadata,authorship')
      .eq('user_id', userId).in('content_type', types), 'created_at')
      .order('created_at', { ascending: false }).limit(limit);
    return (data ?? []) as any[];
  };

  let taken = 0;
  const writingBudget = { chars: POOL_LIMITS.personalWritingChars };
  for (const r of await wordsOf(PERSONAL_WRITING_TYPES, POOL_LIMITS.personalWriting * 4)) {
    if (taken >= POOL_LIMITS.personalWriting || writingBudget.chars <= 0) break;
    if (addWords(r, String(r.content_type).replace(/_/g, ' '), writingBudget)) taken += 1;
  }

  taken = 0;
  for (const r of await wordsOf(['onboarding_profile'], 20)) {
    if (taken >= POOL_LIMITS.onboarding) break;
    if (addWords(r, 'onboarding')) taken += 1;
  }

  // Documents: newest version of each section, then round-robin across
  // documents so one long doc cannot take every slot.
  const sections = new Map<string, any>();
  for (const r of await wordsOf(['google_docs'], 600)) {
    const key = `${r.metadata?.document_id ?? r.id}#${r.metadata?.chunk_index ?? 0}`;
    if (!sections.has(key)) sections.set(key, r);
  }
  const byDoc = new Map<string, any[]>();
  for (const r of sections.values()) {
    const doc = String(r.metadata?.document_id ?? r.id);
    byDoc.set(doc, [...(byDoc.get(doc) ?? []), r]);
  }
  const queues = [...byDoc.values()].map((rows) =>
    rows.sort((x, y) => Number(x.metadata?.chunk_index ?? 0) - Number(y.metadata?.chunk_index ?? 0)));
  taken = 0;
  while (taken < POOL_LIMITS.documentSections && queues.some((q) => q.length)) {
    for (const q of queues) {
      const r = q.shift();
      if (!r || taken >= POOL_LIMITS.documentSections) continue;
      const title = r.metadata?.title ? `document "${r.metadata.title}"` : 'document';
      if (addWords(r, title)) taken += 1;
    }
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
      contentType: contentType || undefined,
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
      contentType: 'pattern',
    });
  }

  // A few recent records of each other kind, so record-based questions have
  // something to work with. Health readings are cleaned so a zero reads as
  // "not recorded" -- the lesson of the false sleep claims.
  for (const type of ['calendar', 'gmail', 'screen_time', 'healthkit']) {
    const limit = type === 'calendar' || type === 'gmail' ? POOL_LIMITS.recordsPerTypeWeekAndPeople : POOL_LIMITS.recordsPerType;
    const { data: fetched } = await after(db.from(Tables.RAW_CONTENT)
      .select('id,content_type,content,content_date,created_at')
      .eq('user_id', userId).eq('content_type', type), 'created_at')
      .order('created_at', { ascending: false })
      .limit(type === 'calendar' ? limit * 5 : limit);
    const records = type === 'calendar' ? distinctEvents((fetched ?? []) as any[], limit) : (fetched ?? []) as any[];
    for (const r of records) {
      // Only what was actually recorded. A "not recorded" line, even labelled
      // as such, was still read as behaviour in the first dry run.
      const text = isHealthSummary(r.content_type) ? recordedReadingsOnly(r.content) : String(r.content ?? '');
      if (!text || text.split('\n').length <= 1) continue;
      add({
        ref: { raw_content_id: r.id }, ownWords: false,
        label: `${type.replace(/_/g, ' ')} · ${day(r.content_date ?? r.created_at)}${r.repeats > 1 ? ` · one of ${r.repeats} with this title` : ''}`,
        text,
        at: r.created_at,
        contentType: r.content_type,
      });
    }
  }

  return pool;
}
