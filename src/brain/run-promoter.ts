/**
 * Persistence for the promoter.
 *
 * promoter.ts is pure decision logic -- it says what a group of facts amounts
 * to. This reads the facts, applies it, and writes the result, keeping the
 * judgment separate from the plumbing so the risky part stays testable.
 */

import { createHash } from 'node:crypto';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import {
  groupFacts, evaluateGroup, decayedConfidence, shouldDemote,
  type FactForPromotion, type Severity,
} from './promoter';
import { canInferWhy, sanitizeWhy, shouldRetireWhy } from './why';

export const PROMOTER_VERSION = 'v1';
/** Facts considered per run. A user past this sees only the newest slice. */
export const PROMOTER_FACT_LIMIT = 2000;

export interface PromoterRunResult {
  groupsConsidered: number;
  created: number;
  promoted: number;
  demoted: number;
  updated: number;
  whysCreated: number;
  whysRetired: number;
}

function labelFor(key: string, facts: FactForPromotion[]): string {
  // Boring on purpose. A metaphor here breaks typed retrieval and invites the
  // writer to improvise (05 D5).
  const anchor = key.split(':')[1] ?? 'behaviour';
  const verb = facts[0]?.predicate.replace(/_/g, ' ') ?? 'does';
  return `${verb} — ${anchor.replace(/_/g, ' ')}`;
}

export async function runPromoter(options: {
  userId: string;
  sourceRunId?: string | null;
  lookbackDays?: number;
}): Promise<PromoterRunResult> {
  const since = new Date(Date.now() - (options.lookbackDays ?? 180) * 864e5).toISOString();
  const result: PromoterRunResult = {
    groupsConsidered: 0, created: 0, promoted: 0, demoted: 0,
    updated: 0, whysCreated: 0, whysRetired: 0,
  };

  const { data: rows, error } = await supabase.from(Tables.ASSERTIONS)
    .select('id,predicate,object_value,event_time,observed_at,metadata,status,valid_to')
    .eq('user_id', options.userId).eq('status', 'active').is('valid_to', null)
    // Explicit order matters: with no ORDER BY, a user past the limit gets an
    // arbitrary subset, and which facts the promoter sees would drift between
    // runs. Newest first, so the slice is at least meaningful and stable.
    .gte('observed_at', since)
    .order('observed_at', { ascending: false })
    .limit(PROMOTER_FACT_LIMIT);
  if (error) throw new Error(`runPromoter load failed: ${error.message}`);

  // Identify each fact's source by its CONTENT, not its row, so that copies of
  // one upload share an id and onePerSource() counts them once. See promoter.ts.
  const contentKeyByRow = await contentKeys(
    (rows ?? []).map((r: any) => r.metadata?.raw_content_id).filter(Boolean) as string[],
  );

  const facts: FactForPromotion[] = (rows ?? []).map((r: any) => ({
    assertionId: r.id,
    predicate: r.predicate,
    object: String(r.object_value?.normalized ?? ''),
    eventTime: r.event_time ?? r.observed_at,
    // Falls back to the row id -- exactly the previous behaviour -- if the
    // content could not be read, so this can never count worse than before.
    sourceId: String(
      contentKeyByRow.get(r.metadata?.raw_content_id) ?? r.metadata?.raw_content_id ?? r.id,
    ),
    contentType: String(r.metadata?.content_type ?? 'journal_entry'),
    severity: (r.metadata?.severity_hint ?? 'standard') as Severity,
    namesOwnLoop: r.metadata?.names_own_loop === true,
    externalCause: (r.metadata?.external_cause as string | null) ?? null,
  })).filter((f) => f.object);

  const groups = groupFacts(facts);
  result.groupsConsidered = groups.size;

  for (const [key, groupFactsList] of groups) {
    const decision = evaluateGroup(groupFactsList);
    if (!decision) continue;

    const { data: existing } = await supabase.from(Tables.BEHAVIOR_PATTERNS)
      .select('*').eq('user_id', options.userId).eq('grouping_key', key).maybeSingle();

    // A pattern the user rejected is never resurrected by a later run.
    if (existing?.status === 'user_rejected') continue;

    const baseConfidence = Math.min(0.95, 0.4 + decision.instanceCount * 0.15);
    const confidence = decayedConfidence({
      baseConfidence, lastSeenAt: decision.lastSeenAt,
    });

    // Decay can pull a live pattern back down: a loop someone stopped dies.
    const status = decision.status === 'live' && shouldDemote(confidence)
      ? 'candidate'
      : decision.status;

    const payload = {
      user_id: options.userId,
      slug: key.replace(/[^a-z0-9]+/gi, '_').toLowerCase(),
      label: labelFor(key, groupFactsList),
      status,
      severity: decision.severity,
      episode_promotable: decision.episodePromotable,
      first_seen_at: decision.firstSeenAt,
      last_seen_at: decision.lastSeenAt,
      instance_count: decision.instanceCount,
      weighted_count: decision.weightedCount,
      source_count: decision.sourceCount,
      confidence,
      grouping_key: key,
      promoter_version: PROMOTER_VERSION,
      source_run_id: options.sourceRunId ?? null,
      metadata: { reason: decision.reason, anchor: key },
      promoted_at: status === 'live' ? (existing?.promoted_at ?? new Date().toISOString()) : null,
    };

    const { data: saved } = await supabase.from(Tables.BEHAVIOR_PATTERNS)
      .upsert(payload, { onConflict: 'user_id,grouping_key' }).select('id,status').single();
    if (!saved) continue;

    if (!existing) result.created += 1;
    else if (existing.status !== 'live' && status === 'live') result.promoted += 1;
    else if (existing.status === 'live' && status !== 'live') result.demoted += 1;
    else result.updated += 1;

    await supabase.from(Tables.BEHAVIOR_PATTERN_FACTS).upsert(
      decision.facts.map((f) => ({
        pattern_id: saved.id, assertion_id: f.assertionId,
        user_id: options.userId, role: 'supports',
      })),
      { onConflict: 'pattern_id,assertion_id' }
    );

    // ── Why: only now, and only if the gate allows ──────────────────────────
    const gate = canInferWhy({
      id: saved.id,
      status: status as any,
      severity: decision.severity,
      instanceCount: decision.instanceCount,
      episodePromotable: decision.episodePromotable,
    });

    const { data: whys } = await supabase.from(Tables.BEHAVIOR_PATTERN_WHYS)
      .select('id,evidence_assertion_ids').eq('pattern_id', saved.id).is('retired_at', null);

    if (!gate.allowed) {
      // A conclusion must not outlive the conditions that justified it.
      for (const w of (whys ?? []) as any[]) {
        const verdict = shouldRetireWhy({
          pattern: { id: saved.id, status: status as any, severity: decision.severity,
                     instanceCount: decision.instanceCount, episodePromotable: decision.episodePromotable },
          liveEvidenceCount: decision.facts.length,
        });
        if (verdict.retire) {
          await supabase.from(Tables.BEHAVIOR_PATTERN_WHYS)
            .update({ status: 'retired', retired_at: new Date().toISOString(),
                      retirement_reason: verdict.reason ?? 'gate closed' })
            .eq('id', w.id);
          result.whysRetired += 1;
        }
      }
      continue;
    }

    if ((whys ?? []).length === 0) {
      // Mechanism from the predicate family, not from a model: v1 keeps the
      // inference boring and auditable. 'unclear' is a perfectly good answer.
      const family = decision.facts[0]?.predicate ?? '';
      const mechanism =
        family === 'skipped_or_avoided' || family === 'quit_or_stopped' ? 'avoidance'
        : family === 'felt' ? 'capacity'
        : 'unclear';

      const draft = sanitizeWhy({
        patternId: saved.id, mechanism,
        evidenceAssertionIds: decision.facts.map((f) => f.assertionId),
      });
      const { error: whyErr } = await supabase.from(Tables.BEHAVIOR_PATTERN_WHYS).insert({
        pattern_id: draft.patternId, user_id: options.userId,
        kind: 'inferred', mechanism: draft.mechanism, confidence: draft.confidence,
        status: 'provisional', evidence_assertion_ids: draft.evidenceAssertionIds,
        model_version: PROMOTER_VERSION,
      });
      // Count only what was actually written. This used to increment whether or
      // not the insert succeeded, so a failure was reported as a success.
      if (!whyErr) {
        result.whysCreated += 1;
      } else if (whyErr.code !== '23505') {
        // 23505 means a concurrent run already wrote this explanation (migration
        // 118) -- the outcome wanted, so not an error. Anything else is.
        console.error(`[promoter] why insert failed for pattern ${draft.patternId}: ${whyErr.message}`);
      }
    }
  }

  return result;
}

/**
 * A content hash for each raw_content row, keyed by row id.
 *
 * Copies of one upload hash to the same key, so they become one source. Read in
 * chunks to stay inside URL and response limits on a large account. A row that
 * cannot be read is simply absent from the map, and its fact falls back to the
 * row id -- the old behaviour -- rather than failing the run.
 *
 * At scale this should read a stored content hash instead of the full text;
 * raw_content.dedup_key (migration 117) is that hash for new rows once the
 * historical ones are backfilled.
 */
async function contentKeys(rawContentIds: string[]): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  const ids = [...new Set(rawContentIds)];
  const CHUNK = 150;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from(Tables.RAW_CONTENT)
      .select('id,content')
      .in('id', ids.slice(i, i + CHUNK));
    if (error) {
      console.warn(`[promoter] could not read source content for de-duplication: ${error.message}`);
      continue;
    }
    for (const row of (data ?? []) as { id: string; content: string | null }[]) {
      keys.set(row.id, createHash('sha256').update(row.content ?? '').digest('hex'));
    }
  }
  return keys;
}
