/**
 * People as part of the user's life -- not a world CRM.
 *
 * Two rules from the locked spec (01 Q7, 05 D7):
 *   significance ~ recency-weighted interactions x intensity x closeness
 *   a barista mentioned once gets a fact; a partner mentioned weekly grows
 *
 * And one identity rule that matters more than it looks (01 test 4):
 *   never merge two people on a first name alone.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

/** Half-life of a mention's contribution. Someone you stopped seeing fades. */
export const SIGNIFICANCE_HALF_LIFE_DAYS = 60;

export interface SignificanceInput {
  mentions: { at: string; intensity?: number }[];
  explicitCloseness?: number;
  now?: Date;
}

/**
 * Pure, so it can be reasoned about and tested without a database.
 *
 * Recency-weighted so the score answers "how much does this person matter to
 * them NOW", not "how much did they ever matter". Without decay, someone from
 * two years ago outranks the person they live with.
 */
export function computeSignificance(input: SignificanceInput): number {
  const now = (input.now ?? new Date()).getTime();
  const halfLifeMs = SIGNIFICANCE_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;

  let weighted = 0;
  for (const m of input.mentions) {
    const age = now - new Date(m.at).getTime();
    if (Number.isNaN(age)) continue;
    const decay = Math.pow(0.5, Math.max(0, age) / halfLifeMs);
    weighted += decay * (m.intensity ?? 1);
  }

  const closeness = input.explicitCloseness ?? 1;
  // Compress so a hundred mentions does not dwarf everything else, and clamp
  // to 0..1 so thresholds mean the same thing over time.
  const raw = Math.log1p(weighted * closeness) / Math.log1p(40);
  return Math.max(0, Math.min(1, raw));
}

/**
 * Is this name safe to merge on?
 *
 * A single token is not. Two different Alexes sharing one entity is
 * unrecoverable: every pattern involving either inherits the error, and the
 * significance of both is split so neither crosses a threshold.
 */
export function isConfidentName(name: string): boolean {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  return tokens.length >= 2;
}

/**
 * Resolve a person named in a journal.
 *
 * Multi-token names merge confidently. A bare first name still resolves --
 * refusing to would fragment every mention -- but records a resolution
 * candidate so the ambiguity is visible and a human can split it, rather than
 * being silently wrong forever. ATOM's contract: cheap match first, escalate
 * what is uncertain.
 */
export async function noteAmbiguousName(options: {
  userId: string;
  entityId: string;
  name: string;
}): Promise<void> {
  if (isConfidentName(options.name)) return;
  await supabase.from(Tables.ENTITY_RESOLUTION_CANDIDATES).upsert({
    user_id: options.userId,
    entity_id: options.entityId,
    candidate_alias: options.name.trim().toLowerCase(),
    namespace: 'journal:name',
    reason: 'single_token_name',
    confidence: 0.4,
    status: 'pending',
  }, { onConflict: 'user_id,entity_id,candidate_alias' });
}

/** Recompute and store significance for one person from their mention history. */
export async function refreshSignificance(options: {
  userId: string;
  entityId: string;
  explicitCloseness?: number;
}): Promise<number> {
  const { data, error } = await supabase
    .from(Tables.ASSERTIONS)
    .select('observed_at,event_time,metadata')
    .eq('user_id', options.userId)
    .or(`subject_entity_id.eq.${options.entityId},object_entity_id.eq.${options.entityId}`)
    .limit(500);
  if (error) throw new Error(`refreshSignificance failed: ${error.message}`);

  const mentions = (data ?? []).map((row: any) => ({
    at: row.event_time ?? row.observed_at,
    intensity:
      (row.metadata?.severity_hint === 'high' ? 1.5 :
       row.metadata?.severity_hint === 'extreme' ? 2 : 1),
  }));

  const score = computeSignificance({ mentions, explicitCloseness: options.explicitCloseness });

  const { data: entity } = await supabase
    .from(Tables.ENTITIES).select('attributes').eq('id', options.entityId).single();
  await supabase.from(Tables.ENTITIES).update({
    attributes: {
      ...((entity?.attributes as Record<string, unknown>) ?? {}),
      significance: score,
      significance_mentions: mentions.length,
      significance_updated_at: new Date().toISOString(),
    },
  }).eq('id', options.entityId);

  return score;
}
