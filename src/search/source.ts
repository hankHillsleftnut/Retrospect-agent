/**
 * Open one search source in full (S1.2b): "look at the sources, and look at
 * what happened there." Always scoped to the person: a source that isn't
 * theirs is simply not found.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export type SourceKind = 'item' | 'fact' | 'answer' | 'saved';

export interface OpenedSource { kind: SourceKind; id: string; date: string | null; title: string; body: string; extra?: Record<string, unknown> }

export async function openSource(userId: string, kind: SourceKind, id: string, db: typeof supabase = supabase): Promise<OpenedSource | null> {
  if (kind === 'item') {
    const { data } = await db.from(Tables.RAW_CONTENT).select('id,content_type,content,created_at').eq('user_id', userId).eq('id', id).maybeSingle();
    const r = data as { id: string; content_type: string; content: string | null; created_at: string } | null;
    return r ? { kind, id, date: String(r.created_at).slice(0, 10), title: r.content_type.replace(/_/g, ' '), body: r.content ?? '' } : null;
  }
  if (kind === 'fact') {
    const { data } = await db.from(Tables.ASSERTIONS).select('id,predicate,object_value,event_time,observed_at').eq('user_id', userId).eq('id', id).maybeSingle();
    const f = data as { id: string; predicate: string; object_value: { raw?: string; normalized?: string }; event_time: string | null; observed_at: string } | null;
    if (!f) return null;
    const { data: ev } = await db.from(Tables.ASSERTION_EVIDENCE).select('excerpt,raw_content_id').eq('assertion_id', id);
    return { kind, id, date: String(f.event_time ?? f.observed_at).slice(0, 10), title: f.predicate.replace(/_/g, ' '), body: f.object_value.raw ?? f.object_value.normalized ?? '',
      extra: { from: ((ev ?? []) as Array<{ excerpt: string | null; raw_content_id: string | null }>).map((e) => ({ quote: e.excerpt, itemId: e.raw_content_id })) } };
  }
  if (kind === 'answer') {
    const { data } = await db.from(Tables.QUESTION_ANSWERS).select('id,question_id,answer,last_moved_at').eq('user_id', userId).eq('id', id).maybeSingle();
    const a = data as { id: string; question_id: number; answer: string; last_moved_at: string } | null;
    if (!a) return null;
    const { data: q } = await db.from(Tables.CANONICAL_QUESTIONS).select('text').eq('id', a.question_id).maybeSingle();
    return { kind, id, date: String(a.last_moved_at).slice(0, 10), title: (q as { text?: string } | null)?.text ?? `Question ${a.question_id}`, body: a.answer };
  }
  const { data } = await db.from(Tables.REFERENCE_ITEMS).select('id,url,title,summary,intent,created_at').eq('user_id', userId).eq('id', id).maybeSingle();
  const s = data as { id: string; url: string; title: string | null; summary: string | null; intent: string | null; created_at: string } | null;
  return s ? { kind: 'saved', id, date: String(s.created_at).slice(0, 10), title: s.title ?? s.url, body: s.summary ?? '', extra: { url: s.url, yourReason: s.intent } } : null;
}
