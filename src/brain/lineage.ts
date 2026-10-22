/**
 * "How do you know that?" -- walk any claim down to what it ultimately rests on.
 *
 * F1.3. Reads the claim_edges view (migration 131), which joins every claim's
 * evidence: answer -> pattern | fact | raw content; why -> pattern, fact;
 * pattern -> fact; fact -> raw content | source item. Used by the guard (does
 * a sentence's claim reach a source?), corrections (what is built on this?) and
 * lint (has a guess acquired no real evidence?).
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { chunks } from '../db/paged';

export type ClaimKind = 'answer' | 'why' | 'pattern' | 'fact';
export type EvidenceKind = ClaimKind | 'raw_content' | 'source_item';

export interface EvidenceNode { kind: EvidenceKind; id: string }
export interface EvidenceStep { from: EvidenceNode; to: EvidenceNode; role: string | null; excerpt: string | null }

export interface Lineage {
  /** Source rows the claim ultimately rests on. Empty means it rests on nothing. */
  sources: EvidenceNode[];
  /** Every edge walked, so the path can be shown. */
  steps: EvidenceStep[];
}

const SOURCE_KINDS = new Set<EvidenceKind>(['raw_content', 'source_item']);
const MAX_DEPTH = 6;

const CLAIM_TABLES: Record<ClaimKind, string> = {
  fact: Tables.ASSERTIONS,
  pattern: Tables.BEHAVIOR_PATTERNS,
  why: Tables.BEHAVIOR_PATTERN_WHYS,
  answer: Tables.QUESTION_ANSWERS,
};

/** Whether a claim is this person's. The agent trusts the user id it is sent, so every walk and write checks. */
export async function claimBelongsTo(userId: string, claim: { kind: ClaimKind; id: string }, db: typeof supabase = supabase): Promise<boolean> {
  const table = CLAIM_TABLES[claim.kind];
  if (!table) return false;
  const { data, error } = await db.from(table).select('id').eq('id', claim.id).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`claimBelongsTo: ${error.code ?? 'failed'}`);
  return data !== null;
}

/**
 * Everything a claim rests on, down to the sources. Scoped to `userId`: a
 * claim that isn't theirs walks to nothing, and every step is filtered by
 * user (BEA.2).
 */
export async function walkEvidence(userId: string, claim: { kind: ClaimKind; id: string }, db: typeof supabase = supabase): Promise<Lineage> {
  if (!(await claimBelongsTo(userId, claim, db))) return { sources: [], steps: [] };
  const sources = new Map<string, EvidenceNode>();
  const steps: EvidenceStep[] = [];
  const seen = new Set<string>([`${claim.kind}:${claim.id}`]);
  let frontier: EvidenceNode[] = [claim];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: EvidenceNode[] = [];
    for (const kind of new Set(frontier.map((n) => n.kind))) {
      const ids = frontier.filter((n) => n.kind === kind).map((n) => n.id);
      // In chunks: a pattern can rest on hundreds of facts, and one URL with
      // hundreds of ids fails (review, 19 Oct; the #56 bug class).
      const data: unknown[] = [];
      for (const part of chunks(ids)) {
        const r = await db.from(Tables.CLAIM_EDGES)
          .select('claim_kind,claim_id,evidence_kind,evidence_id,role,excerpt')
          .eq('user_id', userId).eq('claim_kind', kind).in('claim_id', part);
        if (r.error) throw new Error(`walkEvidence: ${r.error.message}`);
        data.push(...(r.data ?? []));
      }
      for (const e of data as Array<{ claim_kind: ClaimKind; claim_id: string; evidence_kind: EvidenceKind; evidence_id: string; role: string | null; excerpt: string | null }>) {
        const to: EvidenceNode = { kind: e.evidence_kind, id: e.evidence_id };
        steps.push({ from: { kind: e.claim_kind, id: e.claim_id }, to, role: e.role, excerpt: e.excerpt });
        const key = `${to.kind}:${to.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (SOURCE_KINDS.has(to.kind)) sources.set(key, to);
        else next.push(to);
      }
    }
    frontier = next;
  }
  return { sources: [...sources.values()], steps };
}
