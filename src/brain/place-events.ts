/**
 * Place the calendar events the declared rules couldn't (W3.5b).
 *
 * On the founder's calendar the rules left 62% of booked hours as "other".
 * Each distinct unplaced title goes to a small model once, in batches; the
 * answer (including "other") is cached in event_categories, so a title is
 * never asked about twice and a person's correction is never overwritten.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { selectAll } from '../db/paged';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';
import { PLACE_SYSTEM, categoriseByRule, placePrompt, titleKey, vetPlacements } from './time-categories';

const BATCH = 150;
const CHUNK = 100;

export type PlaceModel = (system: string, prompt: string) => Promise<{ data: { placed?: Array<{ i?: unknown; category?: unknown }> }; usage: ClaudeUsage }>;

const defaultModel: PlaceModel = (system, prompt) =>
  claudeJsonCompletion(system, prompt, { model: config.anthropic.timeCategoryModel, maxTokens: 4000 });

export async function placeUnrecognisedEvents(userId: string, db: typeof supabase = supabase, model: PlaceModel = defaultModel) {
  const rows = await selectAll<{ source_item_id: string | null }>((from, to) => db.from(Tables.RAW_CONTENT).select('source_item_id')
    .eq('user_id', userId).eq('content_type', 'calendar').order('id').range(from, to));
  const ids = [...new Set(rows.map((r) => r.source_item_id).filter(Boolean) as string[])];

  const titles = new Map<string, string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await db.from(Tables.SOURCE_ITEMS).select('normalized_data').in('id', ids.slice(i, i + CHUNK));
    for (const s of (data ?? []) as Array<{ normalized_data: { title?: string; attendee_count?: number } | null }>) {
      const t = s.normalized_data?.title;
      if (t && categoriseByRule({ title: t, attendee_count: s.normalized_data?.attendee_count ?? 0 }) === 'other') titles.set(titleKey(t), t);
    }
  }
  const { data: cached } = await db.from(Tables.EVENT_CATEGORIES).select('title_key').eq('user_id', userId);
  for (const c of (cached ?? []) as Array<{ title_key: string }>) titles.delete(c.title_key);

  const todo = [...titles.values()];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let placed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const r = await model(PLACE_SYSTEM, placePrompt(batch));
    usage.inputTokens += r.usage.inputTokens;
    usage.outputTokens += r.usage.outputTokens;
    const decided = vetPlacements(batch, r.data);
    // Titles the model skipped are cached as "other": asked once, never again.
    const rowsOut = batch.map((t) => ({ user_id: userId, title_key: titleKey(t), category: decided.get(titleKey(t)) ?? 'other', decided_by: 'model', model: config.anthropic.timeCategoryModel }));
    const { error: upErr } = await db.from(Tables.EVENT_CATEGORIES).upsert(rowsOut, { onConflict: 'user_id,title_key', ignoreDuplicates: true });
    if (upErr) throw new Error(`placeUnrecognisedEvents save: ${upErr.message}`);
    placed += rowsOut.filter((x) => x.category !== 'other').length;
  }
  return { asked: todo.length, placed, usage };
}
