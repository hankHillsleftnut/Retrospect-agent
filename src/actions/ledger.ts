/**
 * Acting for the person (goal 17), the fork-independent mechanism. Every
 * action is recorded with the person's own message it came from; nothing is
 * proposed from content (an email, a page, a saved link: data, never
 * instructions; CaMeL-style capability separation); nothing runs without
 * approval or a standing authorisation; everything prepared can be undone.
 * Executors are prepare-only: drafts inside Retrospect, no write credentials.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

/** What it can prepare. None of these leave Retrospect. */
export const ACTION_CLASSES = {
  draft_message: 'Draft a message for you to send yourself',
  reminder: 'Remind you about something, inside Retrospect',
  calendar_hold: 'Draft a calendar hold for you to add',
  note: 'Write a note into your bank',
} as const;
export type ActionClass = keyof typeof ACTION_CLASSES;

/** Only the person's own words can start an action (goal 17: content is data). */
const OWN_ORIGIN_TYPES = new Set(['conversation', 'text_entry', 'journal_entry', 'voice_recording', 'voice_journal', 'manual_journal', 'note']);

export function originAllowed(origin: { content_type: string; trust_class: string | null; authorship?: string | null } | null): string | null {
  if (!origin) return 'no origin: an action must come from something you said';
  if (origin.trust_class !== 'own_words') return `came from ${origin.trust_class ?? 'unknown'} content, which is data, never instructions`;
  if (!OWN_ORIGIN_TYPES.has(origin.content_type)) return `came from ${origin.content_type}, not a message of yours`;
  return null;
}

type Db = typeof supabase;

export async function proposeAction(userId: string, a: { actionClass: string; params: Record<string, unknown>; preview: string; originRawContentId: string | null }, db: Db = supabase): Promise<{ id: string; status: string } | { refused: string }> {
  if (!(a.actionClass in ACTION_CLASSES)) return { refused: `unknown action class ${a.actionClass}` };
  const { data: origin } = a.originRawContentId
    ? await db.from(Tables.RAW_CONTENT).select('content_type,trust_class,authorship').eq('id', a.originRawContentId).eq('user_id', userId).maybeSingle()
    : { data: null };
  const refused = originAllowed(origin as { content_type: string; trust_class: string | null } | null);
  if (refused) return { refused };

  const standing = await standingClasses(userId, db);
  const { data, error } = await db.from('actions').insert({
    user_id: userId, action_class: a.actionClass, params: a.params, preview: a.preview, origin_raw_content_id: a.originRawContentId,
    status: standing.has(a.actionClass) ? 'approved' : 'proposed', approved_by: standing.has(a.actionClass) ? 'standing_authorisation' : null,
  }).select('id,status').single();
  if (error) throw new Error(`proposeAction: ${error.message}`);
  return data as { id: string; status: string };
}

/** Classes the person durably authorised (user_preferences.metadata.authorised_actions). */
export async function standingClasses(userId: string, db: Db = supabase): Promise<Set<string>> {
  const { data } = await db.from(Tables.USER_PREFERENCES).select('metadata').eq('user_id', userId).maybeSingle();
  const list = (data as { metadata?: { authorised_actions?: unknown } } | null)?.metadata?.authorised_actions;
  return new Set(Array.isArray(list) ? list.map(String).filter((c) => c in ACTION_CLASSES) : []);
}

async function transition(userId: string, id: string, from: string[], to: Record<string, unknown>, db: Db): Promise<boolean> {
  const { data, error } = await db.from('actions').update({ ...to, status_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId).in('status', from).select('id');
  if (error) throw new Error(`actions: ${error.message}`);
  return ((data as unknown[] | null) ?? []).length === 1;
}

export const approveAction = (userId: string, id: string, db: Db = supabase) => transition(userId, id, ['proposed'], { status: 'approved', approved_by: 'person' }, db);
export const rejectAction = (userId: string, id: string, db: Db = supabase) => transition(userId, id, ['proposed'], { status: 'rejected' }, db);
export const undoAction = (userId: string, id: string, db: Db = supabase) => transition(userId, id, ['done', 'approved'], { status: 'undone' }, db);

/** Prepare approved actions. Prepare-only: the result is a draft inside Retrospect; nothing is sent anywhere. */
export async function runApproved(userId: string, db: Db = supabase): Promise<number> {
  const { data } = await db.from('actions').select('id,action_class,params,preview').eq('user_id', userId).eq('status', 'approved').limit(50);
  let done = 0;
  for (const a of (data ?? []) as Array<{ id: string; action_class: string; params: Record<string, unknown>; preview: string }>) {
    const result = { prepared: true, draft: a.preview, sent: false };
    if (await transition(userId, a.id, ['approved'], { status: 'done', result }, db)) done++;
  }
  return done;
}
