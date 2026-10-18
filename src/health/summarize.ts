/**
 * Is the system actually working?
 *
 * Until now that question was answered by hand-writing SQL against production,
 * a dozen times in one day. Every finding that mattered on 18 October 2026 --
 * the stranded backlog, the 188 duplicate uploads, the 0.5% embedding coverage,
 * the cost meter off by a thousand -- was found that way, and each would have
 * been visible at a glance if this existed.
 *
 * `npm run doctor` asks whether the system *can* run: keys, connectivity,
 * schema. This asks whether it *is* working: what is happening to the data.
 *
 * Everything here is pure. The script fetches counts; this decides what they
 * mean. That keeps the judgement -- where "healthy" ends -- testable, and keeps
 * every threshold in one place where it can be argued with.
 */

/**
 * Where healthy ends. In one place on purpose: these are exactly the numbers
 * that can only be found by watching the system, and a future control panel
 * should be able to read them from here rather than from a dozen call sites.
 *
 * Starting values are the Phase 1 gate in architecture-and-sequence.md.
 */
export const HEALTH_THRESHOLDS = {
  /** Share of all content that has been fully processed. */
  completedShare: 0.9,
  /** Share of content carrying an embedding. Below this, search cannot work. */
  embeddingCoverage: 0.9,
  /** Share of recent ingest runs that failed. Above this, something is broken. */
  recentRunFailureRate: 0.1,
  /** Extraction drop rate above which interpretation needs a look. */
  dropRate: 0.5,
  /** Days of trace history counted as "recent". */
  recentDays: 30,
} as const;

export type Verdict = 'healthy' | 'attention' | 'broken' | 'no data';

export interface Snapshot {
  content: {
    total: number;
    completed: number;
    pending: number;
    processing: number;
    failed: number;
    withEmbedding: number;
    /** Of the failed rows, how many are each kind. Null kind = never classified. */
    failedByKind: { transient: number; terminal: number; not_applicable: number; unclassified: number };
    /** Pending rows scheduled for a retry. */
    pendingRetries: number;
  };
  runs: {
    recentCompleted: number;
    recentFailed: number;
    /** Recent ingest runs' extraction stats, as recorded on the trace. */
    extraction: { candidates: number; written: number; dropped: number; dropReasons: Record<string, number> };
    recentCostUsd: number;
    recentCostByKind: Record<string, number>;
    /** Most recent run of any kind, ISO, or null if none. */
    lastRunAt: string | null;
  };
  bank: {
    assertions: number;
    relations: number;
    entities: number;
    patternsCandidate: number;
    patternsLive: number;
    whys: number;
    lintFindings: number;
  };
}

export interface Section {
  title: string;
  verdict: Verdict;
  /** One sentence a person can act on. */
  headline: string;
  lines: string[];
}

const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`);
const share = (n: number, d: number) => (d === 0 ? null : n / d);

export function contentSection(s: Snapshot['content']): Section {
  const completed = share(s.completed, s.total);
  const coverage = share(s.withEmbedding, s.total);
  const lines = [
    `${s.total} uploads: ${s.completed} processed (${pct(s.completed, s.total)}), ` +
      `${s.pending} waiting, ${s.processing} in progress, ${s.failed} failed`,
    `${s.withEmbedding} searchable — ${pct(s.withEmbedding, s.total)} embedding coverage`,
  ];
  if (s.pendingRetries > 0) lines.push(`${s.pendingRetries} scheduled to retry automatically`);

  if (completed === null) {
    return { title: 'Content', verdict: 'no data', headline: 'Nothing has been uploaded yet.', lines };
  }

  const problems: string[] = [];
  if (completed < HEALTH_THRESHOLDS.completedShare) {
    problems.push(`only ${pct(s.completed, s.total)} of uploads have been processed`);
  }
  if (coverage !== null && coverage < HEALTH_THRESHOLDS.embeddingCoverage) {
    problems.push(`only ${pct(s.withEmbedding, s.total)} are searchable`);
  }

  if (problems.length === 0) {
    return { title: 'Content', verdict: 'healthy', headline: 'Uploads are being processed and indexed.', lines };
  }
  // Below half processed, the product is working on a fraction of what it was
  // given. That is broken, not merely a concern.
  const verdict: Verdict = completed < 0.5 ? 'broken' : 'attention';
  return { title: 'Content', verdict, headline: capitalise(problems.join(', and ')) + '.', lines };
}

export function failureSection(s: Snapshot['content']): Section {
  const k = s.failedByKind;
  const realFailures = k.transient + k.terminal + k.unclassified;
  const lines = [
    `${k.transient} worth retrying, ${k.terminal} that resending would not fix`,
    `${k.not_applicable} not really failures — the pipeline correctly found nothing to extract`,
  ];
  if (k.unclassified > 0) {
    lines.push(
      `${k.unclassified} never classified — invisible to the retry system, which only ` +
        `looks at rows it understands`,
    );
  }

  if (s.failed === 0) {
    return { title: 'Failures', verdict: 'healthy', headline: 'Nothing has failed.', lines };
  }
  if (k.unclassified > 0) {
    // The signature of the stranded backlog: failures the retry system cannot
    // see. These do not recover on their own, whatever their cause.
    return {
      title: 'Failures',
      verdict: 'broken',
      headline: `${k.unclassified} failed uploads will never be retried unless something reclassifies them.`,
      lines,
    };
  }
  // The question this section answers is "does anything need a person?", not
  // "has anything ever failed?". Every real system has occasional failures; a
  // report that flags all of them is a report people learn to ignore.
  //
  // Transient failures retry on their own, so they are normal operation.
  // Terminal ones will not recover by resending, so they are the only kind that
  // needs a look.
  if (k.terminal > 0) {
    return {
      title: 'Failures',
      verdict: 'attention',
      headline: `${k.terminal} uploads failed in a way resending will not fix — they need a look.`,
      lines,
    };
  }
  if (k.transient > 0) {
    return {
      title: 'Failures',
      verdict: 'healthy',
      headline: `${k.transient} failed uploads will retry on their own.`,
      lines,
    };
  }
  return {
    title: 'Failures',
    verdict: 'healthy',
    headline: realFailures === 0
      ? 'Every "failure" is the pipeline correctly declining to extract.'
      : 'Nothing needs attention.',
    lines,
  };
}

export function runsSection(r: Snapshot['runs']): Section {
  const total = r.recentCompleted + r.recentFailed;
  const failRate = share(r.recentFailed, total);
  const lines = [
    `Last ${HEALTH_THRESHOLDS.recentDays} days: ${r.recentCompleted} runs completed, ${r.recentFailed} failed`,
    `Last run: ${r.lastRunAt ?? 'never'}`,
  ];

  if (total === 0) {
    // Not a failure, but worth saying plainly: a pipeline with no recent runs
    // cannot be judged, and a quiet system looks identical to a dead one.
    return {
      title: 'Runs',
      verdict: 'no data',
      headline: `No runs in the last ${HEALTH_THRESHOLDS.recentDays} days — quiet, or not running.`,
      lines,
    };
  }
  if (failRate !== null && failRate > HEALTH_THRESHOLDS.recentRunFailureRate) {
    return {
      title: 'Runs',
      verdict: failRate > 0.5 ? 'broken' : 'attention',
      headline: `${pct(r.recentFailed, total)} of recent runs failed.`,
      lines,
    };
  }
  return { title: 'Runs', verdict: 'healthy', headline: 'Recent runs are succeeding.', lines };
}

export function extractionSection(r: Snapshot['runs']): Section {
  const e = r.extraction;
  const rate = share(e.dropped, e.candidates);
  const lines = [`${e.candidates} candidate facts seen, ${e.written} kept, ${e.dropped} dropped`];
  const reasons = Object.entries(e.dropReasons).sort((a, b) => b[1] - a[1]);
  if (reasons.length > 0) {
    lines.push('Why dropped: ' + reasons.map(([why, n]) => `${why} ${n}`).join(', '));
  }

  if (rate === null) {
    // Expected until migration 116 ships and runs record their stats. Saying
    // so is better than reporting a 0% drop rate, which would read as perfect.
    return {
      title: 'Extraction',
      verdict: 'no data',
      headline: 'No extraction stats recorded yet — nothing can be said about quality.',
      lines,
    };
  }
  if (rate > HEALTH_THRESHOLDS.dropRate) {
    return {
      title: 'Extraction',
      verdict: 'attention',
      headline: `${pct(e.dropped, e.candidates)} of candidate facts were dropped. Check the reasons.`,
      lines,
    };
  }
  return {
    title: 'Extraction',
    verdict: 'healthy',
    headline: `${pct(e.written, e.candidates)} of candidate facts survived verification.`,
    lines,
  };
}

export function bankSection(b: Snapshot['bank']): Section {
  const lines = [
    `${b.assertions} facts, ${b.relations} links between them, ${b.entities} people`,
    `${b.patternsLive} live patterns (${b.patternsCandidate} still candidates), ${b.whys} explanations`,
    `${b.lintFindings} lint findings`,
  ];
  if (b.assertions === 0) {
    return { title: 'Bank', verdict: 'no data', headline: 'The fact bank is empty.', lines };
  }
  // Facts exist but nothing has ever been linked or promoted. Not an error -- it
  // can simply be early -- but it means the bank is a list, not yet a brain.
  if (b.patternsLive === 0 && b.relations === 0) {
    return {
      title: 'Bank',
      verdict: 'attention',
      headline: 'Facts are being stored, but nothing has been linked or promoted to a pattern yet.',
      lines,
    };
  }
  return { title: 'Bank', verdict: 'healthy', headline: 'Facts are stored, linked, and forming patterns.', lines };
}

export function costSection(r: Snapshot['runs']): Section {
  const kinds = Object.entries(r.recentCostByKind).sort((a, b) => b[1] - a[1]);
  const lines = [`$${r.recentCostUsd.toFixed(2)} over the last ${HEALTH_THRESHOLDS.recentDays} days`];
  if (kinds.length > 0) lines.push(kinds.map(([kind, usd]) => `${kind} $${usd.toFixed(2)}`).join(', '));
  // Informational only. There is no cost ceiling to breach yet, and inventing
  // one here would be a guess dressed as a rule.
  return {
    title: 'Cost',
    verdict: r.recentCostUsd === 0 && kinds.length === 0 ? 'no data' : 'healthy',
    headline: `$${r.recentCostUsd.toFixed(2)} spent recently, priced per model.`,
    lines,
  };
}

export function summarize(s: Snapshot): { overall: Verdict; sections: Section[] } {
  const sections = [
    contentSection(s.content),
    failureSection(s.content),
    runsSection(s.runs),
    extractionSection(s.runs),
    bankSection(s.bank),
    costSection(s.runs),
  ];
  const rank: Record<Verdict, number> = { broken: 3, attention: 2, healthy: 1, 'no data': 0 };
  // The system is as healthy as its worst part. "No data" does not count
  // against it: a section with nothing to report is not a failure.
  const overall = sections.reduce<Verdict>(
    (worst, s) => (rank[s.verdict] > rank[worst] ? s.verdict : worst),
    'healthy',
  );
  return { overall, sections };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
