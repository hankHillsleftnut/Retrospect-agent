/**
 * Said versus did: each active goal beside what the person actually did
 * (W4.3, goal 8). Two numbers side by side, never merged into one score, and
 * never editorialised: the episode can show the gap; a reason for it is a
 * hypothesis and goes through its own gates.
 *
 * Which events, content and patterns serve a goal is a judgement, so a small
 * model makes it in one batched call with "none" allowed. Similarity can't:
 * a goal sentence and an event title never score close (findings #34).
 *
 * Honest about coverage: calendar hours are BOOKED time only; most of a day
 * isn't in a calendar, so "did" is a floor, never the whole picture.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { claudeJsonCompletion, type ClaudeUsage } from '../services/anthropic';

export interface Candidate { id: string; kind: 'event' | 'content' | 'pattern'; text: string; hours?: number; recent?: boolean }
export interface GoalInput { id: string; title: string; description: string | null; created_at: string; last_mentioned_at: string | null }

export interface SaidVsDid {
  goalId: string; title: string;
  said: { statedAt: string; lastMentionedAt: string | null };
  did: { hoursThisWeek: number; hoursUsualWeek: number; events: number; contentItems: number; patterns: string[] };
  /** Ids of everything counted, for lineage. */
  evidence: string[];
}

export const JUDGE_SYSTEM = `You decide which of a person's activities clearly serve each of their stated goals.
Only count an item when it plainly works toward the goal (an event, a video they chose, a habit). When unsure, leave it out.
Reply with JSON only: {"links":[{"goal":<goal number>,"items":[<item numbers>]}]} — use an empty list when nothing serves a goal.`;

export function judgePrompt(goals: GoalInput[], items: Candidate[]): string {
  return `GOALS\n${goals.map((g, i) => `${i}: ${g.title}${g.description ? ` — ${g.description}` : ''}`).join('\n')}\n\nACTIVITIES\n${items.map((c, i) => `${i}: [${c.kind}] ${c.text}`).join('\n')}`;
}

/** Keep only links between real goals and real items. Pure. */
export function vetLinks(goals: GoalInput[], items: Candidate[], reply: { links?: Array<{ goal?: unknown; items?: unknown }> }): Map<string, Candidate[]> {
  const out = new Map<string, Candidate[]>(goals.map((g) => [g.id, []]));
  for (const l of reply.links ?? []) {
    const g = goals[Number(l.goal)];
    if (!g || !Array.isArray(l.items)) continue;
    const seen = new Set<number>();
    for (const n of l.items) {
      const i = Number(n);
      if (!Number.isInteger(i) || !items[i] || seen.has(i)) continue;
      seen.add(i);
      out.get(g.id)!.push(items[i]!);
    }
  }
  return out;
}

/** Pure: the two sides for each goal. Event hours are split this week / the four weeks before. */
export function assembleSaidVsDid(goals: GoalInput[], links: Map<string, Candidate[]>, weeksOfBaseline: number): SaidVsDid[] {
  return goals.map((g) => {
    const linked = links.get(g.id) ?? [];
    const events = linked.filter((c) => c.kind === 'event');
    const thisWeek = events.filter((e) => e.recent).reduce((s, e) => s + (e.hours ?? 0), 0);
    const before = events.filter((e) => !e.recent).reduce((s, e) => s + (e.hours ?? 0), 0);
    return {
      goalId: g.id, title: g.title,
      said: { statedAt: g.created_at, lastMentionedAt: g.last_mentioned_at },
      did: {
        hoursThisWeek: Math.round(thisWeek * 10) / 10,
        hoursUsualWeek: weeksOfBaseline ? Math.round((before / weeksOfBaseline) * 10) / 10 : 0,
        events: events.length,
        contentItems: linked.filter((c) => c.kind === 'content').length,
        patterns: linked.filter((c) => c.kind === 'pattern').map((c) => c.text),
      },
      evidence: linked.map((c) => c.id),
    };
  });
}

const DAY = 864e5;

export async function readSaidVsDid(userId: string, db: typeof supabase = supabase, now = new Date(),
  judge: (s: string, p: string) => Promise<{ data: { links?: Array<{ goal?: unknown; items?: unknown }> }; usage: ClaudeUsage }> =
    (s, p) => claudeJsonCompletion(s, p, { model: config.anthropic.timeCategoryModel, maxTokens: 2000 })) {
  const { data: goalRows, error } = await db.from(Tables.GOALS).select('id,title,description,created_at,last_mentioned_at').eq('user_id', userId).eq('status', 'active');
  if (error) throw new Error(`readSaidVsDid goals: ${error.message}`);
  const goals = (goalRows ?? []) as GoalInput[];
  if (!goals.length) return { goals: [], usage: { inputTokens: 0, outputTokens: 0 } };

  const weekStart = now.getTime() - 7 * DAY, start = now.getTime() - 35 * DAY;
  const items: Candidate[] = [];
  // Calendar events in the last five weeks (one line per event, with its hours).
  const { data: cal } = await db.from(Tables.RAW_CONTENT).select('id,source_item_id').eq('user_id', userId).eq('content_type', 'calendar').limit(3000);
  const sids = ((cal ?? []) as Array<{ id: string; source_item_id: string | null }>).filter((r) => r.source_item_id);
  for (let i = 0; i < sids.length; i += 100) {
    const { data } = await db.from(Tables.SOURCE_ITEMS).select('id,normalized_data').in('id', sids.slice(i, i + 100).map((r) => r.source_item_id!));
    for (const s of (data ?? []) as Array<{ id: string; normalized_data: { title?: string; start?: string; end?: string; all_day?: boolean; my_response?: string } | null }>) {
      const n = s.normalized_data;
      if (!n?.start || n.all_day || n.my_response === 'declined') continue;
      const t = Date.parse(n.start);
      if (t < start || t > now.getTime()) continue;
      const hours = Math.max(0, (Date.parse(n.end ?? n.start) - t) / 36e5);
      items.push({ id: sids.find((r) => r.source_item_id === s.id)!.id, kind: 'event', text: n.title ?? '(no title)', hours, recent: t >= weekStart });
    }
  }
  // Live patterns.
  const { data: pats } = await db.from(Tables.BEHAVIOR_PATTERNS).select('id,label,status').eq('user_id', userId).eq('status', 'live');
  for (const p of (pats ?? []) as Array<{ id: string; label: string }>) items.push({ id: p.id, kind: 'pattern', text: p.label });
  // Chosen content in the window (subscriptions dated in it).
  const { data: yt } = await db.from(Tables.RAW_CONTENT).select('id,content,metadata,source_item_id').eq('user_id', userId).eq('content_type', 'youtube').limit(2000);
  const ytRows = ((yt ?? []) as Array<{ id: string; content: string; metadata: Record<string, unknown> | null; source_item_id: string | null }>).filter((r) => r.source_item_id);
  const when = new Map<string, string | null>();
  for (let i = 0; i < ytRows.length; i += 100) {
    const { data } = await db.from(Tables.SOURCE_ITEMS).select('id,occurred_at').in('id', ytRows.slice(i, i + 100).map((r) => r.source_item_id!));
    for (const s of (data ?? []) as Array<{ id: string; occurred_at: string | null }>) when.set(s.id, s.occurred_at);
  }
  for (const r of ytRows) {
    const at = when.get(r.source_item_id!);
    if (!at || Date.parse(at) < now.getTime() - 28 * DAY) continue;
    items.push({ id: r.id, kind: 'content', text: (r.content.split('\n')[0] ?? '').slice(0, 120) });
  }

  const { data: reply, usage } = await judge(JUDGE_SYSTEM, judgePrompt(goals, items));
  const links = vetLinks(goals, items, reply);
  return { goals: assembleSaidVsDid(goals, links, 4), usage, considered: items.length };
}
