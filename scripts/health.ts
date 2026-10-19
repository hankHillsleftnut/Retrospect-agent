#!/usr/bin/env tsx
/**
 * `npm run health` -- is the system actually working?
 *
 *   npm run health                 everyone
 *   npm run health -- --user <id>  one person
 *   npm run health -- --json       machine-readable, for a dashboard or CI
 *
 * Read-only. Counts rows; changes nothing.
 *
 * The judgement -- what counts as healthy -- lives in src/health/summarize.ts,
 * where it is tested. This file only gathers numbers.
 */
import 'dotenv/config';
import { parseArgs, optBool, optStr } from './_args';
import { supabase } from '../src/db/supabase';
import { Tables } from '../src/db/tables';
import { HEALTH_THRESHOLDS, summarize, type Snapshot, type Verdict } from '../src/health/summarize';

type Filter = (q: any) => any;

/** Count rows. Returns null when the query itself fails, so one missing column
 *  degrades one number instead of the whole report. */
async function count(table: string, filter: Filter = (q) => q, userId?: string): Promise<number | null> {
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  if (userId) q = q.eq('user_id', userId);
  const { count: n, error } = await filter(q);
  return error ? null : (n ?? 0);
}

async function gather(userId?: string): Promise<{ snapshot: Snapshot; unavailable: string[] }> {
  const unavailable: string[] = [];
  const n = (label: string, v: number | null) => {
    if (v === null) unavailable.push(label);
    return v ?? 0;
  };
  const RC = Tables.RAW_CONTENT;
  const since = new Date(Date.now() - HEALTH_THRESHOLDS.recentDays * 86_400_000).toISOString();

  const [
    total, completed, pending, processing, failed, withEmbedding,
    transient, terminal, notApplicable, unclassified, pendingRetries,
    assertions, relations, entities, candidate, live, whys, lint,
  ] = await Promise.all([
    count(RC, (q) => q, userId),
    count(RC, (q) => q.eq('processing_status', 'completed'), userId),
    count(RC, (q) => q.eq('processing_status', 'pending'), userId),
    count(RC, (q) => q.eq('processing_status', 'processing'), userId),
    count(RC, (q) => q.eq('processing_status', 'failed'), userId),
    count(RC, (q) => q.not('embedding', 'is', null), userId),
    count(RC, (q) => q.eq('processing_status', 'failed').eq('failure_kind', 'transient'), userId),
    count(RC, (q) => q.eq('processing_status', 'failed').eq('failure_kind', 'terminal'), userId),
    count(RC, (q) => q.eq('failure_kind', 'not_applicable'), userId),
    count(RC, (q) => q.eq('processing_status', 'failed').is('failure_kind', null), userId),
    count(RC, (q) => q.eq('processing_status', 'pending').not('next_attempt_at', 'is', null), userId),
    count(Tables.ASSERTIONS, (q) => q, userId),
    count(Tables.ASSERTION_RELATIONS, (q) => q, userId),
    count(Tables.ENTITIES, (q) => q, userId),
    count(Tables.BEHAVIOR_PATTERNS, (q) => q.eq('status', 'candidate'), userId),
    count(Tables.BEHAVIOR_PATTERNS, (q) => q.eq('status', 'live'), userId),
    count(Tables.BEHAVIOR_PATTERN_WHYS, (q) => q, userId),
    count(Tables.LINT_FINDINGS, (q) => q, userId),
  ]);

  // Recent runs: status, cost, and extraction stats. extraction_stats only
  // exists once migration 116 is applied, so ask for it separately and let its
  // absence mean "no extraction data" rather than a failed report.
  let runsQ = supabase
    .from(Tables.PIPELINE_RUN_TRACES)
    .select('kind, status, started_at, cost_breakdown')
    .gte('started_at', since);
  if (userId) runsQ = runsQ.eq('user_id', userId);
  const { data: runs, error: runsErr } = await runsQ;
  if (runsErr) unavailable.push('recent runs');

  const extraction = { candidates: 0, written: 0, dropped: 0, dropReasons: {} as Record<string, number> };
  let statsQ = supabase
    .from(Tables.PIPELINE_RUN_TRACES)
    .select('extraction_stats')
    .eq('kind', 'ingest')
    .gte('started_at', since)
    .not('extraction_stats', 'is', null);
  if (userId) statsQ = statsQ.eq('user_id', userId);
  const { data: stats, error: statsErr } = await statsQ;
  if (statsErr) unavailable.push('extraction stats (migration 116 not applied?)');
  for (const row of (stats ?? []) as { extraction_stats: any }[]) {
    const e = row.extraction_stats ?? {};
    extraction.candidates += e.candidates ?? 0;
    extraction.written += e.written ?? 0;
    extraction.dropped += e.dropped ?? 0;
    for (const [why, k] of Object.entries((e.drop_reasons ?? {}) as Record<string, number>)) {
      extraction.dropReasons[why] = (extraction.dropReasons[why] ?? 0) + k;
    }
  }

  const recentCostByKind: Record<string, number> = {};
  let recentCostUsd = 0;
  let recentCompleted = 0;
  let recentFailed = 0;
  let lastRunAt: string | null = null;
  for (const r of (runs ?? []) as { kind: string; status: string; started_at: string; cost_breakdown: any }[]) {
    if (r.status === 'completed') recentCompleted += 1;
    if (r.status === 'failed') recentFailed += 1;
    const usd = Number(r.cost_breakdown?.est_usd ?? 0);
    recentCostUsd += usd;
    recentCostByKind[r.kind] = (recentCostByKind[r.kind] ?? 0) + usd;
    if (!lastRunAt || r.started_at > lastRunAt) lastRunAt = r.started_at;
  }

  // "Last run" should mean ever, not just within the window -- a system idle for
  // two months should say so rather than reporting "never".
  if (!lastRunAt) {
    let lastQ = supabase.from(Tables.PIPELINE_RUN_TRACES).select('started_at').order('started_at', { ascending: false }).limit(1);
    if (userId) lastQ = lastQ.eq('user_id', userId);
    const { data: last } = await lastQ;
    lastRunAt = (last?.[0] as { started_at?: string } | undefined)?.started_at ?? null;
  }

  return {
    unavailable,
    snapshot: {
      content: {
        total: n('content total', total),
        completed: n('completed', completed),
        pending: n('pending', pending),
        processing: n('processing', processing),
        failed: n('failed', failed),
        withEmbedding: n('embeddings', withEmbedding),
        failedByKind: {
          transient: n('transient', transient),
          terminal: n('terminal', terminal),
          not_applicable: n('not_applicable (migration 116 not applied?)', notApplicable),
          unclassified: n('unclassified', unclassified),
        },
        pendingRetries: n('pending retries', pendingRetries),
      },
      runs: { recentCompleted, recentFailed, extraction, recentCostUsd, recentCostByKind, lastRunAt },
      bank: {
        assertions: n('assertions', assertions),
        relations: n('relations', relations),
        entities: n('entities', entities),
        patternsCandidate: n('candidate patterns', candidate),
        patternsLive: n('live patterns', live),
        whys: n('whys', whys),
        lintFindings: n('lint findings', lint),
      },
    },
  };
}

const MARK: Record<Verdict, string> = {
  healthy: '\x1b[32m●\x1b[0m',
  attention: '\x1b[33m●\x1b[0m',
  broken: '\x1b[31m●\x1b[0m',
  'no data': '\x1b[2m○\x1b[0m',
};

async function main() {
  const args = parseArgs();
  const userId = optStr(args, 'user') ?? undefined;
  const { snapshot, unavailable } = await gather(userId);
  const { overall, sections } = summarize(snapshot);

  if (optBool(args, 'json')) {
    console.log(JSON.stringify({ overall, sections, unavailable, snapshot }, null, 2));
    return;
  }

  console.log(`\n${MARK[overall]}  Overall: ${overall}${userId ? `   (user ${userId})` : ''}\n`);
  for (const s of sections) {
    console.log(`${MARK[s.verdict]}  ${s.title} — ${s.headline}`);
    for (const line of s.lines) console.log(`     ${line}`);
    console.log();
  }
  if (unavailable.length > 0) {
    console.log(`\x1b[2mCould not read: ${unavailable.join(', ')}\x1b[0m\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
