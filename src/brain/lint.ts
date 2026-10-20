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
import { selectAll, chunks } from '../db/paged';
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
  // Every read pages past the 1,000-row cap and avoids long id lists (F-L1): a
  // capped read here doesn't just miss things, it reports false findings.
  const completedIds = (await selectAll<{ id: string }>((f, t) => supabase.from(Tables.RAW_CONTENT)
    .select('id').eq('user_id', userId).eq('processing_status', 'completed').order('id').range(f, t))).map((r) => r.id);
  const userEvidence = await selectAll<{ assertion_id: string; raw_content_id: string | null; excerpt: string | null }>((f, t) => supabase.from(Tables.ASSERTION_EVIDENCE)
    .select('assertion_id,raw_content_id,excerpt').eq('user_id', userId).order('id').range(f, t));
  if (completedIds.length > 0) {
    const have = new Set(userEvidence.map((r) => r.raw_content_id));
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
  const allFacts = await selectAll<any>((f, t) => supabase.from(Tables.ASSERTIONS)
    .select('id,predicate,object_value,status,valid_to,supersedes_id,subject_entity_id,origin_key')
    .eq('user_id', userId).order('id').range(f, t));

  const factIds = allFacts.map((f) => f.id);
  if (factIds.length > 0) {
    const evidence = userEvidence;
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
      const contentById = new Map<string, string>();
      for (const part of chunks(rawIds as string[])) {
        const { data: sources } = await supabase.from(Tables.RAW_CONTENT).select('id,content').in('id', part);
        for (const src of (sources ?? []) as Array<{ id: string; content: string }>) contentById.set(src.id, src.content);
      }
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
  const people = await selectAll<any>((f, t) => supabase.from(Tables.ENTITIES)
    .select('id,canonical_name,attributes').eq('user_id', userId).eq('entity_type', 'person').order('id').range(f, t));
  for (const p of people) {
    const updated = p.attributes?.significance_updated_at;
    const sig = Number(p.attributes?.significance ?? 0);
    if (sig > 0.3 && updated && now - new Date(updated).getTime() > staleMs) {
      findings.push(make('E3', 'entity', [p.id],
        `significance ${sig.toFixed(2)} not recomputed since ${String(updated).slice(0, 10)}`));
    }
  }

  const candidates = await selectAll<any>((f, t) => supabase.from(Tables.ENTITY_RESOLUTION_CANDIDATES)
    .select('id,created_at').eq('user_id', userId).eq('status', 'pending').order('id').range(f, t));
  const oldCandidates = candidates.filter(
    (c: any) => now - new Date(c.created_at).getTime() > 14 * 864e5
  );
  if (oldCandidates.length > 0) {
    findings.push(make('E2', 'entity_resolution_candidate', oldCandidates.map((c: any) => c.id),
      `${oldCandidates.length} unresolved for over two weeks`));
  }

  // ── Patterns ──────────────────────────────────────────────────────────────
  const allPatterns = await selectAll<any>((f, t) => supabase.from(Tables.BEHAVIOR_PATTERNS)
    .select('*').eq('user_id', userId).order('id').range(f, t));

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
    const live = new Set(livePatternIds);
    const links = (await selectAll<{ pattern_id: string; assertion_id: string }>((f, t) => supabase.from(Tables.BEHAVIOR_PATTERN_FACTS)
      .select('pattern_id,assertion_id').eq('user_id', userId).order('pattern_id').order('assertion_id').range(f, t))).filter((l) => live.has(l.pattern_id));
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
  const whys = await selectAll<any>((f, t) => supabase.from(Tables.BEHAVIOR_PATTERN_WHYS)
    .select('*').eq('user_id', userId).is('retired_at', null).order('id').range(f, t));
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

  // ── Hypothesis hardening (goal 5) ─────────────────────────────────────────
  // H1: a guess said twice or more without the person confirming it. H2: a
  // provisional why that nothing has supported for 60 days.
  const said = new Map<string, number>();
  const bump = (k: string | undefined | null) => { if (k) said.set(k, (said.get(k) ?? 0) + 1); };
  const episodes = await selectAll<{ outline: any }>((f, t) => supabase.from(Tables.PODCAST_EPISODES)
    .select('outline').eq('user_id', userId).eq('status', 'ready').order('id').range(f, t));
  for (const e of episodes) {
    if (e.outline?.planner !== 'v2') continue;
    bump(e.outline.plan?.reflection?.whyId ? `why:${e.outline.plan.reflection.whyId}` : null);
    for (const i of (e.outline.plan?.items ?? []) as Array<{ id?: string; register?: string }>) if (i.register === 'asked') bump(i.id);
  }
  const briefs = await selectAll<{ items: any }>((f, t) => supabase.from(Tables.DAILY_BRIEFS)
    .select('items').eq('user_id', userId).order('id').range(f, t));
  for (const b of briefs) for (const i of (b.items ?? []) as Array<{ planId?: string; register?: string }>) if (i.register === 'asked') bump(i.planId);

  for (const w of whys) {
    if (w.status !== 'provisional') continue;
    const n = said.get(`why:${w.id}`) ?? 0;
    if (n >= 2) findings.push(make('H1', 'behavior_pattern_why', [w.id], `asked ${n} times, never confirmed`));
    const since = w.updated_at ?? w.created_at;
    if (since && now - new Date(since).getTime() > 60 * 864e5) findings.push(make('H2', 'behavior_pattern_why', [w.id], `no new support since ${String(since).slice(0, 10)}`));
  }
  const askedAnswers = [...said.entries()].filter(([k, n]) => k.startsWith('answer:') && n >= 2).map(([k]) => k.slice('answer:'.length));
  for (const part of chunks(askedAnswers)) {
    const { data: open } = await supabase.from(Tables.QUESTION_ANSWERS).select('id').eq('user_id', userId).eq('status', 'active').is('user_verdict', null).in('id', part);
    for (const a of (open ?? []) as Array<{ id: string }>) findings.push(make('H1', 'question_answer', [a.id], `asked ${said.get(`answer:${a.id}`)} times, never confirmed`));
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

/**
 * Upsert findings so a nightly run updates rather than piles up. A finding that
 * stops occurring is marked resolved ("no longer detected"), and reopens if it
 * comes back, unless a person called it a false positive. Without this, an
 * open finding would block a claim forever once it was fixed (F-L1).
 */
export async function persistFindings(report: LintReport): Promise<{ opened: number; resolved: number }> {
  const all = [...report.safety, ...report.findings];
  const seenNow = new Set(all.map((f) => `${f.checkId}|${f.fingerprint}`));
  let opened = 0;

  for (const f of all) {
    const { data: existing } = await supabase.from(Tables.LINT_FINDINGS)
      .select('id,run_count,resolution').eq('user_id', report.userId)
      .eq('check_id', f.checkId).eq('fingerprint', f.fingerprint).maybeSingle();

    if (existing) {
      const reopen = existing.resolution === 'resolved';
      await supabase.from(Tables.LINT_FINDINGS).update({
        last_seen_at: report.ranAt,
        run_count: (existing.run_count ?? 1) + 1,
        detail: f.detail ?? null,
        subject_ids: f.subjectIds,
        ...(reopen ? { resolution: 'open', resolved_at: null, resolution_note: null } : {}),
      }).eq('id', existing.id);
      if (reopen) opened++;
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
      opened++;
    }
  }

  const open = await selectAll<{ id: string; check_id: string; fingerprint: string }>((f, t) => supabase.from(Tables.LINT_FINDINGS)
    .select('id,check_id,fingerprint').eq('user_id', report.userId).eq('resolution', 'open').order('id').range(f, t));
  const gone = open.filter((o) => !seenNow.has(`${o.check_id}|${o.fingerprint}`)).map((o) => o.id);
  for (const part of chunks(gone)) {
    await supabase.from(Tables.LINT_FINDINGS).update({ resolution: 'resolved', resolved_at: report.ranAt, resolution_note: 'no longer detected' }).in('id', part);
  }
  return { opened, resolved: gone.length };
}
