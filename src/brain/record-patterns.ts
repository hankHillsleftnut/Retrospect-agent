/**
 * Patterns from records, not only from what someone writes (W3.2).
 *
 * Most people write little; the founder wrote 5 entries in four months while
 * their calendar and health filled every day. So behaviour has to be readable
 * from records. Declared detectors read the daily summaries (W3.1); each day a
 * detector fires becomes one FACT, with that day's items as evidence. The
 * existing promoter then turns repeated days into a pattern, at its usual bar,
 * so lineage (F1), trajectory (W3.3) and correction all apply unchanged.
 *
 * Rules, fixed before any data was looked at:
 *  - Only behaviour a record can show (trust.ts: 'scheduled', 'health_metric').
 *    Never a feeling, never a reason.
 *  - A reading that wasn't recorded never fires a detector (zeros are dropped
 *    upstream; see health-summary.ts).
 *  - Detectors that can say things got better exist alongside the others:
 *    a product that only notices bad days is not believed (goal 25).
 *  - Objects share no tokens, so the promoter can't fuse two detectors into
 *    one pattern (it clusters on shared tokens).
 */

import type { DailySummary } from './daily-summaries';
import { rebuildDailySummariesWithDetail } from './daily-summaries';
import { selfClaimAllowed } from './trust';
import { supabase } from '../db/supabase';
import { resolveEntity } from '../pipelines/graph-v2';
import { runPromoter } from './run-promoter';

export interface Detector {
  id: string;
  domain: DailySummary['domain'];
  predicate: 'scheduled' | 'health_metric';
  /** Becomes the fact's object; distinct tokens per detector. */
  object: string;
  /** Plain words, for the record and the dashboard. */
  meaning: string;
  fires(m: DailySummary['metrics']): boolean;
  /** The line in an item that shows it, used as the verbatim excerpt. */
  evidenceLine: RegExp;
}

const num = (v: unknown) => (typeof v === 'number' ? v : null);

export const DETECTORS: readonly Detector[] = [
  { id: 'meeting_heavy', domain: 'calendar', predicate: 'scheduled', object: 'meeting_heavy',
    meaning: '5 or more hours booked in the calendar', fires: (m) => (num(m.hours_booked) ?? 0) >= 5, evidenceLine: /^Calendar event:.*$/m },
  { id: 'late_finish', domain: 'calendar', predicate: 'scheduled', object: 'late_finish',
    meaning: 'something booked until 9pm or later', fires: (m) => typeof m.last_end === 'string' && m.last_end >= '21:00', evidenceLine: /^Calendar event:.*$/m },
  { id: 'short_sleep', domain: 'health', predicate: 'health_metric', object: 'short_sleep',
    meaning: 'under 6 hours of recorded sleep', fires: (m) => { const s = num(m.sleep_hours); return s !== null && s < 6; }, evidenceLine: /^\s*Sleep:.*$/m },
  { id: 'sedentary', domain: 'health', predicate: 'health_metric', object: 'sedentary',
    meaning: 'under 3,000 steps', fires: (m) => { const s = num(m.steps); return s !== null && s < 3000; }, evidenceLine: /^\s*Steps:.*$/m },
  { id: 'very_active', domain: 'health', predicate: 'health_metric', object: 'very_active',
    meaning: '10,000 steps or more', fires: (m) => (num(m.steps) ?? 0) >= 10000, evidenceLine: /^\s*Steps:.*$/m },
  { id: 'exercised', domain: 'health', predicate: 'health_metric', object: 'exercised',
    meaning: '30 or more minutes of exercise', fires: (m) => (num(m.exercise_minutes) ?? 0) >= 30, evidenceLine: /^\s*Exercise:.*$/m },
];

export interface RecordInstance {
  detector: Detector;
  day: string;
  /** Up to five items that show it, each with the verbatim line. */
  evidence: Array<{ raw_content_id: string; excerpt: string }>;
}

/** Days each detector fires on. Evidence lines are taken verbatim from the items. */
export function detectRecordInstances(summaries: DailySummary[], textById: Map<string, string>): RecordInstance[] {
  const out: RecordInstance[] = [];
  for (const s of summaries) {
    for (const d of DETECTORS) {
      if (d.domain !== s.domain || !d.fires(s.metrics)) continue;
      if (!selfClaimAllowed('record', d.predicate)) continue;
      const evidence = s.source_ids
        .map((id) => ({ raw_content_id: id, excerpt: (textById.get(id) ?? '').match(d.evidenceLine)?.[0]?.trim() ?? '' }))
        .filter((e) => e.excerpt)
        .slice(0, 5);
      if (evidence.length) out.push({ detector: d, day: s.day, evidence });
    }
  }
  return out;
}

/** The write_fact payload for one instance. Idempotent: one fact per detector per day. */
export function recordFactPayload(userId: string, selfEntityId: string, i: RecordInstance) {
  return {
    user_id: userId,
    subject_entity_id: selfEntityId,
    predicate: i.detector.predicate,
    object_value: { normalized: i.detector.object, raw: i.detector.meaning },
    origin_key: `daily:${i.detector.id}:${i.day}`,
    event_time: `${i.day}T12:00:00Z`,
    assertion_kind: 'observed',
    metadata: { raw_content_id: i.evidence[0]!.raw_content_id, content_type: 'daily_summary', detector: i.detector.id, day: i.day },
    evidence: i.evidence,
  };
}

// ── Writing them ──────────────────────────────────────────────────────────────


/**
 * Rebuild the days, write a fact for each detected day, and let the promoter
 * look again if anything new was written. Safe to repeat: one fact per
 * detector per day (origin_key), rewritten in place.
 */
export async function refreshRecordBehaviour(userId: string, days = 14, db: typeof supabase = supabase, now = new Date(), options: { writeFacts?: boolean } = {}) {
  const { summaries, textById, rows } = await rebuildDailySummariesWithDetail(userId, days, db, now);
  // Summaries always; facts only once the founder has checked the detectors
  // against their own days (ENABLE_RECORD_PATTERNS). A day under 3,000 steps
  // may be a phone left on a desk, the zero-sleep trap again.
  const writeFacts = options.writeFacts ?? process.env.ENABLE_RECORD_PATTERNS === 'true';
  if (!writeFacts) return { summaries: rows, facts: 0, promoted: null };
  const instances = detectRecordInstances(summaries, textById);
  if (instances.length === 0) return { summaries: rows, facts: 0, promoted: null };
  const self = await resolveEntity({
    userId, entityType: 'identity', canonicalName: 'Self',
    aliases: [{ namespace: 'retrospect:user', alias: userId }],
  });
  for (const i of instances) {
    const { error } = await db.rpc('write_fact', { p: recordFactPayload(userId, self, i) });
    if (error) throw new Error(`refreshRecordBehaviour write_fact: ${error.message}`);
  }
  const promoted = await runPromoter({ userId });
  return { summaries: rows, facts: instances.length, promoted };
}
