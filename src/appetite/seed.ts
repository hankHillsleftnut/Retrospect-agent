/**
 * Goal 22, the founder's design (20 Oct): a first guess at how boldly to
 * speak, made from the person's own words, shown in onboarding with that
 * option preselected; then behaviour adjusts it. Safety rails are code, not
 * the model: a guess never exceeds 2 ("don't hold back" is chosen or earned),
 * distress in their words caps it at 1, and too little to read means 0.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import type { Level } from './appetite';

export const SEED_MAX: Level = 2;
export const MIN_ENTRIES = 3;
// Words that mean "go gently right now". Checked in code so no model can talk past them.
const DISTRESS = /\b(grief|grieving|funeral|died|passed away|panic attack|can'?t cope|cannot cope|hopeless|breakdown|overwhelmed|exhausted|burn(ed|t) out|so anxious|depressed|suicid|self[- ]harm|hurt myself)\b/i;

export const SEED_SYSTEM = `You help a personal reflection app decide how boldly to speak to someone, from their own words only. Judge the language, never their personality or mental health.
Levels: 0 = only facts and patterns; 1 = one gentle "why" question now and then; 2 = honest observations and guesses asked as questions; 3 = direct challenge.
Signs toward higher: they reflect on themselves, name their own patterns or contradictions, ask for honesty or to be challenged, talk about growth.
Signs toward lower: short or guarded answers, asking for gentleness, a hard period, little self-reflection.
Reply with JSON only: {"level": 0-3, "reasons": ["a short quote of their words and what it suggests", "..."]}`;

type Model = (s: string, p: string) => Promise<{ data: { level?: unknown; reasons?: unknown }; usage: ClaudeUsage }>;
export interface Seed { level: Level; reasons: string[]; capped: string | null }

/** Pure: apply the rails to whatever the model suggested. */
export function applyRails(suggested: number, texts: string[]): { level: Level; capped: string | null } {
  if (texts.length < MIN_ENTRIES) return { level: 0, capped: `fewer than ${MIN_ENTRIES} things they wrote: start at 0` };
  let level = Math.max(0, Math.min(3, Math.round(Number.isFinite(suggested) ? suggested : 0)));
  if (texts.some((t) => DISTRESS.test(t)) && level > 1) return { level: 1, capped: 'something hard in their words: at most 1' };
  if (level > SEED_MAX) return { level: SEED_MAX, capped: 'a first guess never goes above 2' };
  return { level: level as Level, capped: null };
}

export async function seedFromWords(texts: string[], options: { model?: Model } = {}): Promise<Seed & { usage: ClaudeUsage }> {
  const zero = { inputTokens: 0, outputTokens: 0 };
  if (texts.length < MIN_ENTRIES) return { ...applyRails(0, texts), reasons: [], usage: zero };
  const model = options.model ?? ((s, p) => claudeJsonCompletion(s, p, { model: config.anthropic.writerModel, maxTokens: 400 }));
  const prompt = `THEIR OWN WORDS\n${texts.slice(0, 30).map((t, i) => `[${i + 1}] ${t.slice(0, 600)}`).join('\n')}`;
  const r = await model(SEED_SYSTEM, prompt).catch(() => model(SEED_SYSTEM, prompt)).catch(() => null);
  if (!r) return { level: 0, capped: 'could not read: start at 0', reasons: [], usage: zero };
  const rails = applyRails(Number(r.data.level), texts);
  return { ...rails, reasons: (Array.isArray(r.data.reasons) ? r.data.reasons : []).map(String).slice(0, 3), usage: r.usage };
}

/**
 * Make the first guess once, from their own words, and keep it as `suggested`
 * (shown in onboarding, preselected). If they haven't chosen and nothing has
 * been learned yet, it is also where inference starts. Never overwrites a choice.
 */
export async function seedAppetite(userId: string, options: { db?: typeof supabase; model?: Model; now?: Date } = {}): Promise<Seed | null> {
  const db = options.db ?? supabase;
  const { data: pref } = await db.from(Tables.USER_PREFERENCES).select('id,metadata').eq('user_id', userId).maybeSingle();
  const row = pref as { id: string; metadata: Record<string, any> | null } | null;
  const metadata = row?.metadata ?? {};
  const stored = (metadata.appetite ?? {}) as { stated?: Level | null; inferred?: Level; suggested?: unknown };
  if (stored.suggested) return null;

  const { data } = await db.from(Tables.RAW_CONTENT).select('content').eq('user_id', userId).eq('trust_class', 'own_words').not('content', 'is', null).order('created_at', { ascending: false }).limit(30);
  const texts = ((data ?? []) as Array<{ content: string }>).map((r) => r.content).filter((t) => t.trim().length > 20);
  if (texts.length < MIN_ENTRIES) return null;   // wait until there is something to read
  const seed = await seedFromWords(texts, { model: options.model });
  const at = (options.now ?? new Date()).toISOString();
  const appetite = {
    ...stored,
    suggested: { level: seed.level, reasons: seed.reasons, capped: seed.capped, at },
    ...(stored.stated == null && stored.inferred === undefined ? { inferred: seed.level, reasons: [`first guess from your words: ${seed.reasons[0] ?? 'see suggested'}`] } : {}),
  };
  const next = { ...metadata, appetite };
  const { error } = row ? await db.from(Tables.USER_PREFERENCES).update({ metadata: next }).eq('id', row.id) : await db.from(Tables.USER_PREFERENCES).insert({ user_id: userId, metadata: next });
  if (error) throw new Error(`seedAppetite: ${error.message}`);
  return seed;
}
