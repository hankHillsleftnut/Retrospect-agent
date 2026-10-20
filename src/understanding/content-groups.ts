/**
 * What they paid attention to, grouped by topic (W4.4, the content lens).
 *
 * Only content they chose: YouTube subscriptions, and liked videos that are
 * provably recent (a video published inside the window can only have been
 * liked inside it; older likes carry no date and are left out). Received mail
 * is not attention. Docs are their own writing, read elsewhere.
 *
 * Declared before running on anyone's data (19 Oct):
 *  - Same topic: average cosine similarity >= 0.45 (text-embedding-3-large).
 *    Set after seeing one person's similarity spread (median 0.30, p90 0.42,
 *    p99 0.53), never the groups it makes. A first rule (the person's own
 *    90th percentile) failed its test: with few tight topics the percentile
 *    lands inside a topic and nothing merges.
 *  - Average-linkage clustering, deterministic. A group needs >= 3 items;
 *    smaller ones are "scattered".
 *  - Goal links are NOT made by similarity here. Measured 19 Oct: a goal
 *    sentence and a video title are different kinds of text, so their
 *    similarity is low across the board (max 0.45 over 24,495 pairs) and the
 *    same-topic bar can never link them. Linking moves to W4.3, judged
 *    directly ("is this group about this goal?") with "none" allowed.
 *  - Names describe the content ("woodworking", "fundraising"), never a feeling.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { selectAll, chunks } from '../db/paged';
import { config } from '../config';
import { claudeJsonCompletion } from '../services/anthropic';

export const MIN_GROUP = 3;
export const SAME_TOPIC = 0.45;

export interface ContentItem { id: string; title: string; kind: string; vector: number[] }
export interface ContentGroup { itemIds: string[]; titles: string[]; goalIds: string[]; label: string | null }

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Average-linkage agglomerative clustering, merging while the closest pair clears the bar. */
export function cluster(items: ContentItem[], threshold: number): ContentItem[][] {
  let groups = items.map((i) => [i]);
  const sim = (a: ContentItem[], b: ContentItem[]) => {
    let s = 0;
    for (const x of a) for (const y of b) s += cosine(x.vector, y.vector);
    return s / (a.length * b.length);
  };
  for (;;) {
    let best = -1, bi = -1, bj = -1;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const s = sim(groups[i]!, groups[j]!);
      if (s > best) { best = s; bi = i; bj = j; }
    }
    if (bi < 0 || best < threshold) break;
    groups = [...groups.filter((_, k) => k !== bi && k !== bj), [...groups[bi]!, ...groups[bj]!]];
  }
  return groups;
}

const centroid = (vs: number[][]) => vs[0]!.map((_, d) => vs.reduce((s, v) => s + v[d]!, 0) / vs.length);

export function contentGroups(items: ContentItem[], goals: Array<{ id: string; vector: number[] }>): { groups: ContentGroup[]; scattered: number; threshold: number } {
  const threshold = SAME_TOPIC;
  const all = cluster(items, threshold);
  const groups = all.filter((g) => g.length >= MIN_GROUP).map((g) => {
    const c = centroid(g.map((i) => i.vector));
    return {
      itemIds: g.map((i) => i.id).sort(), titles: g.map((i) => i.title),
      goalIds: goals.filter((goal) => cosine(c, goal.vector) >= threshold).map((goal) => goal.id),
      label: null,
    };
  }).sort((a, b) => b.itemIds.length - a.itemIds.length);
  return { groups, scattered: all.filter((g) => g.length < MIN_GROUP).reduce((n, g) => n + g.length, 0), threshold: Math.round(threshold * 100) / 100 };
}

// ── Naming ───────────────────────────────────────────────────────────────────

const FEELING = /\b(anxi|sad|depress|lonel|stress|burn(ed|t)? ?out|fear|afraid|insecur|unhapp|struggl|crisis|escap|cop(e|ing)|obsess|addict)/i;

export const NAME_SYSTEM = `You name groups of videos someone chose to follow or like. For each group give a short, neutral topic name of 1 to 4 words describing the CONTENT (e.g. "woodworking", "startup fundraising", "jazz piano"). Never describe the person or a feeling. Reply with JSON only: {"names":[{"g":<number>,"name":"<name>"}]}`;

/** Keep a name only if it's short and describes content, not a feeling. Pure. */
export function vetName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  if (!n || n.split(/\s+/).length > 4 || FEELING.test(n)) return null;
  return n.toLowerCase();
}

export async function nameGroups(groups: ContentGroup[], model = (s: string, p: string) => claudeJsonCompletion<{ names?: Array<{ g?: unknown; name?: unknown }> }>(s, p, { model: config.anthropic.timeCategoryModel, maxTokens: 800 })) {
  if (!groups.length) return { groups, usage: { inputTokens: 0, outputTokens: 0 } };
  const prompt = groups.map((g, i) => `Group ${i}:\n${g.titles.slice(0, 12).map((t) => `- ${t}`).join('\n')}`).join('\n\n');
  const { data, usage } = await model(NAME_SYSTEM, prompt);
  const named = groups.map((g) => ({ ...g }));
  for (const n of data.names ?? []) {
    const i = Number(n.g);
    if (Number.isInteger(i) && named[i]) named[i]!.label = vetName(n.name);
  }
  return { groups: named, usage };
}

// ── Reading ──────────────────────────────────────────────────────────────────

const parseVector = (v: unknown): number[] | null => {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === 'string' && v.startsWith('[')) return JSON.parse(v) as number[];
  return null;
};

export async function readContentGroups(userId: string, db: typeof supabase = supabase, now = new Date(), days = 28) {
  const since = new Date(now.getTime() - days * 864e5).toISOString();
  // Rows first without embeddings (paged), dates checked, then embeddings for
  // the kept rows only: 3,072 numbers each is too much to fetch for everything.
  const rows = await selectAll<{ id: string; content: string; metadata: Record<string, unknown> | null; source_item_id: string | null }>((from, to) =>
    db.from(Tables.RAW_CONTENT).select('id,content,metadata,source_item_id,created_at').eq('user_id', userId).eq('content_type', 'youtube').order('id').range(from, to));
  const ids = rows.map((r) => r.source_item_id).filter(Boolean) as string[];
  const when = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from(Tables.SOURCE_ITEMS).select('id,occurred_at').in('id', ids.slice(i, i + 100));
    for (const s of (data ?? []) as Array<{ id: string; occurred_at: string | null }>) when.set(s.id, s.occurred_at);
  }
  const kept = rows.filter((r) => {
    const rel = String(r.metadata?.relationship ?? '');
    // A watch from the Takeout import is dated by when it was watched (created_at); likes and subscriptions by their source item.
    const at = rel === 'watched' ? (r as { created_at?: string }).created_at ?? null : r.source_item_id ? when.get(r.source_item_id) : null;
    return (rel === 'subscribed_to' || rel === 'liked_video' || rel === 'watched') && !!at && at >= since;
  });
  const vectors = new Map<string, number[]>();
  for (const part of chunks(kept.map((r) => r.id), 50)) {
    const { data } = await db.from(Tables.RAW_CONTENT).select('id,embedding').in('id', part);
    for (const e of (data ?? []) as Array<{ id: string; embedding: unknown }>) { const v = parseVector(e.embedding); if (v) vectors.set(e.id, v); }
  }
  const items: ContentItem[] = [];
  for (const r of kept) {
    const rel = String(r.metadata?.relationship ?? '');
    const vector = vectors.get(r.id);
    if (!vector) continue;
    items.push({ id: r.id, kind: rel, title: (r.content.split('\n')[0] ?? '').replace(/^(liked video|subscribed to|watched):\s*/i, '').slice(0, 120), vector });
  }
  // No goal links by similarity: see the note at the top (cross-type text).
  return { considered: items.length, ...contentGroups(items, []) };
}
