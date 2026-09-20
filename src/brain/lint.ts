/**
 * Lint -- detection only.
 *
 * READS. NEVER WRITES to the derived layer. Auto-repairing a bank is how you
 * silently delete evidence; findings carry a suggested remediation and a human
 * (or A12's explicit capabilities) applies it.
 *
 * Detection ships before remediation on purpose: building eight repair
 * capabilities before knowing which findings ever fire is speculative work.
 * The one exception is the safety alert path, because a safety finding sitting
 * in a list waiting for tooling is the failure it exists to prevent.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { CHECKS_BY_ID, fingerprint, isSafety, type Severity } from './lint-catalog';
import { LEASE_TTL_MS } from './lease';
import { decayedConfidence, shouldDemote } from './promoter';
import { verifyExcerpt } from './verify-span';
import { STATEFUL_PREDICATES } from './supersession';

export interface Finding {
  checkId: string;
  severity: Severity;
  subjectKind: string;
  subjectIds: string[];
  prevents: string;
  detail?: string;
  remediation: string;
  fingerprint: string;
}

function make(checkId: string, subjectKind: string, subjectIds: string[], detail?: string): Finding {
  const def = CHECKS_BY_ID[checkId]!;
  return {
    checkId,
    severity: def.severity,
    subjectKind,
    subjectIds,
    prevents: def.prevents,
    detail,
    remediation: def.remediation,
    fingerprint: fingerprint(checkId, subjectIds),
  };
}

export interface LintReport {
  userId: string;
  ranAt: string;
  findings: Finding[];
  safety: Finding[];
  counts: Record<Severity, number>;
}

export async function runLint(options: {
  userId: string;
  staleWeeks?: number;
}): Promise<LintReport> {
  const userId = options.userId;
  const staleMs = (options.staleWeeks ?? 6) * 7 * 864e5;
  const now = Date.now();
  const findings: Finding[] = [];

  // ── Sources ───────────────────────────────────────────────────────────────
  const { data: completed } = await supabase.from(Tables.RAW_CONTENT)
    .select('id').eq('user_id', userId).eq('processing_status', 'completed').limit(1000);
  const completedIds = (completed ?? []).map((r: any) => r.id);
  if (completedIds.length > 0) {
    const { data: withFacts } = await supabase.from(Tables.ASSERTION_EVIDENCE)
      .select('raw_content_id').in('raw_content_id', completedIds);
    const have = new Set((withFacts ?? []).map((r: any) => r.raw_content_id));
    const barren = completedIds.filter((id: string) => !have.has(id));
    if (barren.length > 0) {
      findings.push(make('S1', 'raw_content', barren.slice(0, 50),
        `${barren.length} completed row(s) produced no facts`));
    }
  }

  const leaseCutoff = new Date(now - LEASE_TTL_MS).toISOString();
  const { data: stuck } = await supabase.from(Tables.RAW_CONTENT)
    .select('id').eq('user_id', userId).eq('processing_status', 'processing')
    .lt('processing_started_at', leaseCutoff).limit(100);
  if ((stuck ?? []).length > 0) {
    findings.push(make('S2', 'raw_content', (stuck ?? []).map((r: any) => r.id),
      'lease expired but the row is still marked processing'));
  }

  const staleCutoff = new Date(now - 6 * 3600e3).toISOString();
  const { data: pending } = await supabase.from(Tables.RAW_CONTENT)
    .select('id').eq('user_id', userId).eq('processing_status', 'pending')
    .lt('created_at', staleCutoff).limit(100);
  if ((pending ?? []).length > 0) {
    findings.push(make('S3', 'raw_content', (pending ?? []).map((r: any) => r.id),
      `${(pending ?? []).length} row(s) pending for over six hours`));
  }

  // ── Facts ─────────────────────────────────────────────────────────────────
  const { data: facts } = await supabase.from(Tables.ASSERTIONS)
    .select('id,predicate,object_value,status,valid_to,supersedes_id,subject_entity_id,origin_key')
    .eq('user_id', userId).limit(2000);
  const allFacts = (facts ?? []) as any[];

  const factIds = allFacts.map((f) => f.id);
  if (factIds.length > 0) {
    const { data: evidence } = await supabase.from(Tables.ASSERTION_EVIDENCE)
      .select('assertion_id,raw_content_id,excerpt').in('assertion_id', factIds);
    const evByFact = new Map<string, any[]>();
    for (const e of (evidence ?? []) as any[]) {
      evByFact.set(e.assertion_id, [...(evByFact.get(e.assertion_id) ?? []), e]);
    }

    const orphans = allFacts.filter((f) => !evByFact.has(f.id)).map((f) => f.id);
    if (orphans.length > 0) {
      findings.push(make('F2', 'assertion', orphans.slice(0, 50),
        `${orphans.length} fact(s) with no evidence row`));
    }

    // F1: does the quote still exist in the source it cites?
    const rawIds = [...new Set((evidence ?? []).map((e: any) => e.raw_content_id).filter(Boolean))];
    if (rawIds.length > 0) {
      const { data: sources } = await supabase.from(Tables.RAW_CONTENT)
        .select('id,content').in('id', rawIds as string[]);
      const contentById = new Map((sources ?? []).map((s: any) => [s.id, s.content as string]));
      const broken: string[] = [];
      for (const e of (evidence ?? []) as any[]) {
        if (!e.raw_content_id || !e.excerpt) continue;
        const src = contentById.get(e.raw_content_id);
        if (!src) continue;
        if (!verifyExcerpt(e.excerpt, src).ok) broken.push(e.assertion_id);
      }
      if (broken.length > 0) {
        findings.push(make('F1', 'assertion', [...new Set(broken)].slice(0, 50),
          'excerpt no longer appears in its source -- sources are supposed to be immutable'));
      }
    }
  }

  // F3: two active facts that contradict
  const active = allFacts.filter((f) => f.status === 'active' && f.valid_to === null);
  const bySubjPred = new Map<string, any[]>();
  for (const f of active) {
    const k = `${f.subject_entity_id}|${f.predicate}`;
    bySubjPred.set(k, [...(bySubjPred.get(k) ?? []), f]);
  }
  for (const [k, rows] of bySubjPred) {
    const predicate = k.split('|')[1]!;
    if (!STATEFUL_PREDICATES.has(predicate)) continue;
    const objects = new Set(rows.map((r) => String(r.object_value?.normalized ?? '')));
    if (rows.length > 1 && objects.size > 1) {
      findings.push(make('F3', 'assertion', rows.map((r) => r.id),
        `${rows.length} active "${predicate}" facts disagree`));
    }
  }

  // F4 / F5: structural inconsistency
  const f4 = allFacts.filter((f) => f.valid_to !== null && f.status === 'active').map((f) => f.id);
  if (f4.length > 0) findings.push(make('F4', 'assertion', f4.slice(0, 50), 'valid_to set but status still active'));

  const supersededIds = new Set(allFacts.filter((f) => f.status === 'superseded').map((f) => f.id));
  const pointedAt = new Set(allFacts.map((f) => f.supersedes_id).filter(Boolean));
  const f5 = [...supersededIds].filter((id) => !pointedAt.has(id));
  if (f5.length > 0) findings.push(make('F5', 'assertion', f5.slice(0, 50), 'superseded with a broken relation chain'));

  // F6: the same claim under two different origin keys
  const seen = new Map<string, string[]>();
  for (const f of allFacts) {
    const k = `${f.subject_entity_id}|${f.predicate}|${String(f.object_value?.normalized ?? '')}`;
    seen.set(k, [...(seen.get(k) ?? []), f.id]);
  }
  for (const [, ids] of seen) {
    if (ids.length > 1) {
      findings.push(make('F6', 'assertion', ids,
        'duplicate facts inflate instance_count and can push a behaviour over the promotion bar'));
    }
  }

  // ── Entities ──────────────────────────────────────────────────────────────
  const { data: people } = await supabase.from(Tables.ENTITIES)
    .select('id,canonical_name,attributes').eq('user_id', userId).eq('entity_type', 'person').limit(500);
  for (const p of (people ?? []) as any[]) {
    const updated = p.attributes?.significance_updated_at;
    const sig = Number(p.attributes?.significance ?? 0);
    if (sig > 0.3 && updated && now - new Date(updated).getTime() > staleMs) {
      findings.push(make('E3', 'entity', [p.id],
        `significance ${sig.toFixed(2)} not recomputed since ${String(updated).slice(0, 10)}`));
    }
  }

  const { data: candidates } = await supabase.from(Tables.ENTITY_RESOLUTION_CANDIDATES)
    .select('id,created_at').eq('user_id', userId).eq('status', 'pending').limit(200);
  const oldCandidates = (candidates ?? []).filter(
    (c: any) => now - new Date(c.created_at).getTime() > 14 * 864e5
  );
  if (oldCandidates.length > 0) {
    findings.push(make('E2', 'entity_resolution_candidate', oldCandidates.map((c: any) => c.id),
      `${oldCandidates.length} unresolved for over two weeks`));
  }

  // ── Patterns ──────────────────────────────────────────────────────────────
  const { data: patterns } = await supabase.from(Tables.BEHAVIOR_PATTERNS)
    .select('*').eq('user_id', userId).limit(500);
  const allPatterns = (patterns ?? []) as any[];

  for (const p of allPatterns) {
    if (p.severity === 'extreme' && p.episode_promotable) {
      findings.push(make('P5', 'behavior_pattern', [p.id],
        'extreme severity pattern is marked episode-promotable'));
    }
    if (p.status !== 'live') continue;

    if (p.last_seen_at) {
      const conf = decayedConfidence({ baseConfidence: p.confidence, lastSeenAt: p.last_seen_at });
      if (shouldDemote(conf)) {
        findings.push(make('P1', 'behavior_pattern', [p.id],
          `no supporting fact since ${String(p.last_seen_at).slice(0, 10)}; decayed confidence ${conf}`));
      }
    }
    const bar = p.severity === 'high' ? 2 : 3;
    if (p.instance_count < bar) {
      findings.push(make('P3', 'behavior_pattern', [p.id],
        `live with ${p.instance_count} instances, bar is ${bar}`));
    }
  }

  // P2 / P4 need the fact links
  const livePatternIds = allPatterns.filter((p) => p.status === 'live').map((p) => p.id);
  if (livePatternIds.length > 0) {
    const { data: links } = await supabase.from(Tables.BEHAVIOR_PATTERN_FACTS)
      .select('pattern_id,assertion_id').in('pattern_id', livePatternIds);
    const byPattern = new Map<string, string[]>();
    for (const l of (links ?? []) as any[]) {
      byPattern.set(l.pattern_id, [...(byPattern.get(l.pattern_id) ?? []), l.assertion_id]);
    }
    const activeIds = new Set(active.map((f) => f.id));

    for (const [patternId, assertionIds] of byPattern) {
      const liveCount = assertionIds.filter((id) => activeIds.has(id)).length;
      if (assertionIds.length > 0 && liveCount === 0) {
        findings.push(make('P2', 'behavior_pattern', [patternId],
          'every supporting fact has been retired -- the pattern outlives its evidence'));
      }
    }

    const entries = [...byPattern.entries()];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [aId, aFacts] = entries[i]!;
        const [bId, bFacts] = entries[j]!;
        const shared = aFacts.filter((f) => bFacts.includes(f)).length;
        const smaller = Math.min(aFacts.length, bFacts.length);
        if (smaller > 0 && shared / smaller > 0.6) {
          findings.push(make('P4', 'behavior_pattern', [aId, bId],
            `${shared} shared facts -- probable duplicate. FLAG ONLY, never auto-merge.`));
        }
      }
    }
  }

  // ── Whys ──────────────────────────────────────────────────────────────────
  const { data: whys } = await supabase.from(Tables.BEHAVIOR_PATTERN_WHYS)
    .select('*').eq('user_id', userId).is('retired_at', null).limit(500);
  const patternById = new Map(allPatterns.map((p) => [p.id, p]));
  const activeIds = new Set(active.map((f) => f.id));

  for (const w of (whys ?? []) as any[]) {
    const p = patternById.get(w.pattern_id);
    if (!p || p.status !== 'live') {
      findings.push(make('W1', 'behavior_pattern_why', [w.id],
        `why attached to a pattern that is ${p?.status ?? 'missing'}`));
    }
    if (p?.severity === 'extreme') {
      findings.push(make('W4', 'behavior_pattern_why', [w.id],
        'why attached to an extreme-severity pattern'));
    }
    if (Number(w.confidence) > 0.6) {
      findings.push(make('W3', 'behavior_pattern_why', [w.id],
        `confidence ${w.confidence} exceeds the provisional ceiling`));
    }
    const ev: string[] = w.evidence_assertion_ids ?? [];
    if (ev.length > 0 && ev.every((id) => !activeIds.has(id))) {
      findings.push(make('W2', 'behavior_pattern_why', [w.id],
        'every evidence fact behind this inference has been retired'));
    }
  }

  // ── Portrait ──────────────────────────────────────────────────────────────
  const { data: uu } = await supabase.from(Tables.USER_UNDERSTANDING)
    .select('document,updated_at').eq('user_id', userId)
    .order('version', { ascending: false }).limit(1).maybeSingle();

  if (!uu && allFacts.length > 0) {
    findings.push(make('Po5', 'user_understanding', [], 'user has facts but no portrait'));
  } else if (uu) {
    const blocks = (uu.document as any)?.portrait_blocks ?? {};
    const livePatternSet = new Set(livePatternIds);
    for (const [slot, block] of Object.entries(blocks) as [string, any][]) {
      if (!block?.populated) continue;
      const aIds: string[] = block.sourceAssertionIds ?? [];
      const pIds: string[] = block.sourcePatternIds ?? [];
      if (aIds.length === 0 && pIds.length === 0) {
        findings.push(make('Po3', 'user_understanding', [], `block "${slot}" has text but no source IDs`));
      }
      if (aIds.some((id) => !activeIds.has(id))) {
        findings.push(make('Po1', 'user_understanding', [], `block "${slot}" cites retired facts`));
      }
      if (pIds.some((id) => !livePatternSet.has(id))) {
        findings.push(make('Po2', 'user_understanding', [], `block "${slot}" cites patterns that are not live`));
      }
    }
    const built = (uu.document as any)?.portrait_built_at;
    if (built && now - new Date(built).getTime() > 30 * 864e5) {
      findings.push(make('Po4', 'user_understanding', [], `portrait last built ${String(built).slice(0, 10)}`));
    }
  }

  const counts: Record<Severity, number> = { safety: 0, bug: 0, rot: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;

  return {
    userId,
    ranAt: new Date().toISOString(),
    findings: findings.filter((f) => !isSafety(f.checkId)),
    // Safety leaves the list entirely.
    safety: findings.filter((f) => isSafety(f.checkId)),
    counts,
  };
}

/** Upsert findings so a nightly run updates rather than piles up. */
export async function persistFindings(report: LintReport): Promise<void> {
  const all = [...report.safety, ...report.findings];
  if (all.length === 0) return;

  for (const f of all) {
    const { data: existing } = await supabase.from(Tables.LINT_FINDINGS)
      .select('id,run_count').eq('user_id', report.userId)
      .eq('check_id', f.checkId).eq('fingerprint', f.fingerprint).maybeSingle();

    if (existing) {
      await supabase.from(Tables.LINT_FINDINGS).update({
        last_seen_at: report.ranAt,
        run_count: (existing.run_count ?? 1) + 1,
        detail: f.detail ?? null,
      }).eq('id', existing.id);
    } else {
      await supabase.from(Tables.LINT_FINDINGS).insert({
        user_id: report.userId,
        check_id: f.checkId,
        severity: f.severity,
        subject_kind: f.subjectKind,
        subject_ids: f.subjectIds,
        fingerprint: f.fingerprint,
        prevents: f.prevents,
        detail: f.detail ?? null,
        suggested_remediation: f.remediation,
        first_seen_at: report.ranAt,
        last_seen_at: report.ranAt,
      });
    }
  }
}
