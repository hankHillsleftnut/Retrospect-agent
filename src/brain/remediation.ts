/**
 * Remediation -- the repairs lint findings ask for.
 *
 * Three rules, and the third is the one that matters:
 *
 *  1. Lint never calls these. A human, or an explicit job, does. Auto-repair
 *     on detection is how you silently delete evidence.
 *  2. Patterns are NEVER auto-merged. P4 flags and stops. Merging is the exact
 *     failure the promoter guards against; this must not be a back door to it.
 *  3. Every correction writes remediation_log. Facts trace to spans, patterns
 *     to facts, episodes to packs -- a repair path without the same trail
 *     would be the one unaccountable thing in the system.
 *
 * Each capability is idempotent: applying it twice changes nothing the second
 * time, so a retry is always safe.
 *
 * docs/second-brain/13 "Capabilities this requires", 09 A12.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export type Capability =
  | 'reprocess_source'
  | 'rerun_derivation'
  | 'machine_retire'
  | 'structural_repair'
  | 'merge_assertions'
  | 'escalate';

export interface AuditEntry {
  userId: string;
  capability: Capability;
  findingId?: string | null;
  checkId?: string | null;
  targetTable: string;
  targetIds: string[];
  beforeState?: unknown;
  afterState?: unknown;
  actor?: string;
  reason: string;
  succeeded?: boolean;
  error?: string | null;
}

/** Nothing below may touch the bank without going through here first. */
export async function audit(entry: AuditEntry, db: RepairDb = supabase): Promise<void> {
  await db.from(Tables.REMEDIATION_LOG).insert({
    user_id: entry.userId,
    capability: entry.capability,
    finding_id: entry.findingId ?? null,
    check_id: entry.checkId ?? null,
    target_table: entry.targetTable,
    target_ids: entry.targetIds,
    before_state: entry.beforeState ?? null,
    after_state: entry.afterState ?? null,
    actor: entry.actor ?? 'system',
    reason: entry.reason,
    succeeded: entry.succeeded ?? true,
    error: entry.error ?? null,
  });
}

export interface RemediationContext {
  userId: string;
  findingId?: string | null;
  checkId?: string | null;
  actor?: string;
  reason: string;
}

/** Minimal client surface, so repairs are testable without a database. */
export type RepairDb = Pick<typeof supabase, 'from'>;

export interface RemediationResult {
  changed: number;
  skipped: number;
  note?: string;
}

/**
 * S1 / S3: send a source row back through ingest, overriding the
 * completed-skip. Origin keys mean the re-extract upserts, so this cannot
 * duplicate facts -- which is what makes retry the cheap default.
 */
export async function reprocessSource(
  ctx: RemediationContext,
  rawContentIds: string[],
  db: RepairDb = supabase
): Promise<RemediationResult> {
  if (rawContentIds.length === 0) return { changed: 0, skipped: 0 };

  const { data: before } = await db.from(Tables.RAW_CONTENT)
    .select('id,processing_status').in('id', rawContentIds);

  const { data: after, error } = await db.from(Tables.RAW_CONTENT)
    .update({ processing_status: 'pending', processing_started_at: null, processing_error: null })
    .in('id', rawContentIds).select('id');
  if (error) throw new Error(`reprocessSource failed: ${error.message}`);

  await audit({
    ...ctx, capability: 'reprocess_source',
    targetTable: 'raw_content', targetIds: rawContentIds,
    beforeState: before, afterState: after,
  }, db);
  return { changed: (after ?? []).length, skipped: rawContentIds.length - (after ?? []).length };
}

/**
 * F1 / F2 / W1 / W2 / P2: retire something because the SYSTEM found it wrong.
 *
 * Kept distinct from user_confirmed / contradicted, which are things a person
 * said. Conflating a repair with human feedback would corrupt the one signal
 * worth learning from later.
 */
export async function machineRetire(
  ctx: RemediationContext,
  target: { table: 'assertions' | 'behavior_patterns' | 'behavior_pattern_whys'; ids: string[] },
  db: RepairDb = supabase
): Promise<RemediationResult> {
  if (target.ids.length === 0) return { changed: 0, skipped: 0 };
  const stamp = `system:${ctx.checkId ?? 'manual'}`;
  const nowIso = new Date().toISOString();

  const { data: before } = await db.from(target.table)
    .select('*').in('id', target.ids);

  // Idempotent: rows already retired are left alone.
  const patch: Record<string, unknown> =
    target.table === 'assertions'
      ? { status: 'retired', valid_to: nowIso, retired_by: stamp, retirement_reason: ctx.reason }
      : target.table === 'behavior_patterns'
        ? { status: 'retired', retired_at: nowIso, retirement_reason: ctx.reason }
        : { status: 'retired', retired_at: nowIso, retirement_reason: ctx.reason };

  let q = db.from(target.table).update(patch).in('id', target.ids);
  q = target.table === 'assertions' ? q.neq('status', 'retired') : q.is('retired_at', null);

  const { data: after, error } = await q.select('id');
  if (error) throw new Error(`machineRetire failed: ${error.message}`);

  await audit({
    ...ctx, capability: 'machine_retire',
    targetTable: target.table, targetIds: target.ids,
    beforeState: before, afterState: after,
  }, db);
  return { changed: (after ?? []).length, skipped: target.ids.length - (after ?? []).length };
}

/** F4 / F5: correct status and relation inconsistencies by a defined
 *  operation rather than ad-hoc SQL nobody can review. */
export async function structuralRepair(
  ctx: RemediationContext,
  repair: { kind: 'valid_to_without_status' | 'broken_supersession_chain'; ids: string[] },
  db: RepairDb = supabase
): Promise<RemediationResult> {
  if (repair.ids.length === 0) return { changed: 0, skipped: 0 };

  const { data: before } = await db.from(Tables.ASSERTIONS)
    .select('id,status,valid_to,supersedes_id').in('id', repair.ids);

  let changed = 0;
  if (repair.kind === 'valid_to_without_status') {
    const { data } = await db.from(Tables.ASSERTIONS)
      .update({ status: 'superseded' })
      .in('id', repair.ids).eq('status', 'active').not('valid_to', 'is', null)
      .select('id');
    changed = (data ?? []).length;
  } else {
    // A superseded row nothing points at cannot be repaired by guessing a
    // successor. Mark it retired so queries stop treating it as current, and
    // record that the chain was lost rather than inventing one.
    const { data } = await db.from(Tables.ASSERTIONS)
      .update({ status: 'retired', retirement_reason: 'supersession chain lost; no successor found' })
      .in('id', repair.ids).eq('status', 'superseded')
      .select('id');
    changed = (data ?? []).length;
  }

  await audit({
    ...ctx, capability: 'structural_repair',
    targetTable: 'assertions', targetIds: repair.ids,
    beforeState: before, afterState: { kind: repair.kind, changed },
  }, db);
  return { changed, skipped: repair.ids.length - changed };
}

/**
 * F6: collapse duplicate facts into one, MOVING all evidence to the survivor.
 *
 * Evidence is never dropped: the duplicates exist because something wrote the
 * same claim twice, and their receipts are still real. The oldest row wins so
 * the fact keeps its original observation date.
 */
export async function mergeAssertions(
  ctx: RemediationContext,
  assertionIds: string[],
  db: RepairDb = supabase
): Promise<RemediationResult> {
  if (assertionIds.length < 2) return { changed: 0, skipped: assertionIds.length };

  const { data: rows } = await db.from(Tables.ASSERTIONS)
    .select('*').in('id', assertionIds).order('observed_at', { ascending: true });
  const all = (rows ?? []) as any[];
  if (all.length < 2) return { changed: 0, skipped: assertionIds.length };

  const survivor = all[0]!;
  const losers = all.slice(1).map((r) => r.id);

  await db.from(Tables.ASSERTION_EVIDENCE)
    .update({ assertion_id: survivor.id }).in('assertion_id', losers);

  await db.from(Tables.BEHAVIOR_PATTERN_FACTS)
    .update({ assertion_id: survivor.id }).in('assertion_id', losers);

  const { data: after } = await db.from(Tables.ASSERTIONS)
    .update({
      status: 'retired',
      retired_by: `system:${ctx.checkId ?? 'F6'}`,
      retirement_reason: `merged into ${survivor.id}`,
    })
    .in('id', losers).select('id');

  await audit({
    ...ctx, capability: 'merge_assertions',
    targetTable: 'assertions', targetIds: assertionIds,
    beforeState: all.map((r) => ({ id: r.id, origin_key: r.origin_key })),
    afterState: { survivor: survivor.id, retired: losers },
  }, db);
  return { changed: (after ?? []).length, skipped: 0, note: `survivor ${survivor.id}` };
}

/**
 * P4 and E1/E2: hand it to a person.
 *
 * There is deliberately no mergePatterns function in this file. Two live
 * patterns sharing facts is a judgment call, and the promoter's entire design
 * is built on under-merging; a repair path that merged them automatically
 * would undo that in the one place nobody is looking.
 */
export async function escalate(
  ctx: RemediationContext,
  target: { table: string; ids: string[]; question: string },
  db: RepairDb = supabase
): Promise<RemediationResult> {
  await audit({
    ...ctx, capability: 'escalate',
    targetTable: target.table, targetIds: target.ids,
    afterState: { question: target.question, awaiting: 'human decision' },
  }, db);

  if (ctx.findingId) {
    await db.from(Tables.LINT_FINDINGS)
      .update({ resolution: 'acknowledged', resolution_note: target.question })
      .eq('id', ctx.findingId);
  }
  return { changed: 0, skipped: target.ids.length, note: 'awaiting human decision' };
}

/** Capabilities that exist. Anything absent here is deliberately not built. */
export const AVAILABLE_CAPABILITIES: Capability[] = [
  'reprocess_source',
  'rerun_derivation',
  'machine_retire',
  'structural_repair',
  'merge_assertions',
  'escalate',
];

/** Which capability a finding asks for. Unmapped checks escalate rather than
 *  guess -- doing nothing is always a safe default here. */
export const REMEDIATION_FOR_CHECK: Record<string, Capability> = {
  S1: 'reprocess_source',
  S2: 'escalate',
  S3: 'reprocess_source',
  F1: 'machine_retire',
  F2: 'machine_retire',
  F3: 'rerun_derivation',
  F4: 'structural_repair',
  F5: 'structural_repair',
  F6: 'merge_assertions',
  E1: 'escalate',
  E2: 'escalate',
  E3: 'rerun_derivation',
  P1: 'rerun_derivation',
  P2: 'machine_retire',
  P3: 'rerun_derivation',
  P4: 'escalate',
  P5: 'escalate',
  W1: 'machine_retire',
  W2: 'machine_retire',
  W3: 'machine_retire',
  W4: 'escalate',
  Po1: 'rerun_derivation',
  Po2: 'rerun_derivation',
  Po3: 'rerun_derivation',
  Po4: 'rerun_derivation',
  Po5: 'rerun_derivation',
};
