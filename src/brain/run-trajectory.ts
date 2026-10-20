/**
 * Refresh every pattern's trajectory for one person (W3.3b, corrected W3.3c).
 *
 * Found on the founder's account the day it shipped (19 Oct): 8 of 8
 * "strengthening" patterns were artifacts, from two mistakes this now guards:
 *
 *  1. One item, many facts. A single uploaded conversation produced 10-20 facts
 *     for one pattern, each counted as an instance. Now: one instance per
 *     source item per day, the same rule the promoter applies (onePerSource).
 *  2. Connecting a source looks like a surge. Gmail, YouTube and the calendar
 *     were connected that month, so their whole history landed "recent" and
 *     none "before". Now: an instance counts only if its kind of source was
 *     already sending material during the earlier window (coverage-matched
 *     exposure). Comparing two rates assumes equal observation; a source that
 *     wasn't connected wasn't observing.
 *
 * Instances are timed by when the behaviour happened: the source item's own
 * time when there is one, then the fact's event time, then when it was learned.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { trajectoryOf, windowCounts } from './trajectory';
import { selectAll } from '../db/paged';

const CHUNK = 100;
const DAY = 864e5;

/** Writing in any form is one way of being observed; each connected source is its own. */
const OWN_WORDS = new Set(['journal_entry', 'voice_recording', 'voice_journal', 'text_entry', 'conversation', 'video_journal', 'onboarding_profile']);
export const coverageKind = (contentType: string) => (OWN_WORDS.has(contentType) ? 'own_words' : contentType);

export interface Instance { sourceKey: string; contentType: string; at: string }

/** One instance per source item per day. Pure. */
export function distinctInstances(instances: Instance[]): Instance[] {
  const seen = new Set<string>();
  return instances.filter((i) => {
    const k = `${i.sourceKey}|${i.at.slice(0, 10)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Instances from sources that were already observing before the recent window. Pure. */
export function coverageMatched(instances: Instance[], typesSeenBefore: Set<string>): Instance[] {
  return instances.filter((i) => typesSeenBefore.has(coverageKind(i.contentType)));
}

export async function refreshTrajectories(userId: string, db: typeof supabase = supabase, now = new Date(), recentDays = 28, priorDays = 28): Promise<Record<string, number>> {
  const split = new Date(now.getTime() - recentDays * DAY).toISOString();
  const start = new Date(now.getTime() - (recentDays + priorDays) * DAY).toISOString();

  // Which kinds of source were sending material during the earlier window:
  // one paged read of the types (a single read stops at 1,000 rows, in no set
  // order, and could miss a kind entirely; review, 19 Oct).
  const before = await selectAll<{ content_type: string }>((from, to) => db.from(Tables.RAW_CONTENT).select('content_type')
    .eq('user_id', userId).gte('created_at', start).lte('created_at', split).order('id').range(from, to));
  const typesSeenBefore = new Set(before.map((r) => coverageKind(r.content_type)));

  const { data: patterns, error } = await db.from(Tables.BEHAVIOR_PATTERNS).select('id').eq('user_id', userId);
  if (error) throw new Error(`refreshTrajectories patterns: ${error.message}`);
  const tally: Record<string, number> = {};
  for (const { id } of (patterns ?? []) as Array<{ id: string }>) {
    const { data: links } = await db.from(Tables.BEHAVIOR_PATTERN_FACTS).select('assertion_id').eq('pattern_id', id);
    const factIds = ((links ?? []) as Array<{ assertion_id: string }>).map((l) => l.assertion_id);
    const raw: Instance[] = [];
    for (let i = 0; i < factIds.length; i += CHUNK) {
      const { data: facts } = await db.from(Tables.ASSERTIONS).select('id,event_time,observed_at,status,valid_to,metadata').in('id', factIds.slice(i, i + CHUNK));
      for (const f of (facts ?? []) as Array<{ id: string; event_time: string | null; observed_at: string; status: string; valid_to: string | null; metadata: Record<string, unknown> | null }>) {
        if (f.status !== 'active' || f.valid_to) continue;
        const m = f.metadata ?? {};
        const contentType = String(m.content_type ?? 'unknown');
        // A detected day stands for its day's records; its coverage is the
        // records' (health, calendar), recorded on the fact by its detector.
        const coverageType = contentType === 'daily_summary' ? String(m.source_content_type ?? 'healthkit') : contentType;
        raw.push({ sourceKey: String(m.raw_content_id ?? f.id), contentType: coverageType, at: f.event_time ?? f.observed_at });
      }
    }
    const counted = coverageMatched(distinctInstances(raw), typesSeenBefore);
    const { prior, recent } = windowCounts(counted.map((i) => i.at), now, recentDays, priorDays);
    const t = { ...trajectoryOf(prior, recent, priorDays, recentDays), instancesLeftOut: raw.length - counted.length };
    tally[t.trajectory] = (tally[t.trajectory] ?? 0) + 1;
    const { error: upErr } = await db.from(Tables.BEHAVIOR_PATTERNS)
      .update({ trajectory: t.trajectory, trajectory_detail: t, trajectory_at: now.toISOString() }).eq('id', id);
    if (upErr) throw new Error(`refreshTrajectories update: ${upErr.message}`);
  }
  return tally;
}
