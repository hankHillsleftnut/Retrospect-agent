import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bankSection,
  contentSection,
  extractionSection,
  failureSection,
  runsSection,
  summarize,
  type Snapshot,
} from '../src/health/summarize';

/**
 * The verdicts are the point of the health report, so the boundaries are what
 * get tested. The first case is production as it stood on 18 October 2026: if
 * the report had existed, this is what it would have said.
 */

function snapshot(over: Partial<{ content: Partial<Snapshot['content']>; runs: Partial<Snapshot['runs']>; bank: Partial<Snapshot['bank']> }> = {}): Snapshot {
  return {
    content: {
      total: 100, completed: 95, pending: 3, processing: 0, failed: 2, withEmbedding: 95,
      // A healthy system still fails sometimes. Only self-healing failures here.
      failedByKind: { transient: 2, terminal: 0, not_applicable: 0, unclassified: 0 },
      pendingRetries: 2,
      ...over.content,
    },
    runs: {
      recentCompleted: 20, recentFailed: 0,
      extraction: { candidates: 100, written: 80, dropped: 20, dropReasons: { excerpt_not_found: 20 } },
      recentCostUsd: 3.5, recentCostByKind: { ingest: 3.5 }, lastRunAt: '2026-10-18T00:00:00Z',
      ...over.runs,
    },
    bank: {
      assertions: 200, relations: 40, entities: 12, patternsCandidate: 5, patternsLive: 3, whys: 2, lintFindings: 0,
      ...over.bank,
    },
  };
}

test('production on 18 October 2026 reads as broken, for the right reasons', () => {
  const production = snapshot({
    content: {
      total: 2270, completed: 221, pending: 25, processing: 0, failed: 2024, withEmbedding: 12,
      failedByKind: { transient: 0, terminal: 0, not_applicable: 0, unclassified: 2024 },
      pendingRetries: 11,
    },
    runs: { recentCompleted: 4, recentFailed: 0, extraction: { candidates: 0, written: 0, dropped: 0, dropReasons: {} } },
    bank: { assertions: 19, relations: 0, entities: 2, patternsCandidate: 16, patternsLive: 0, whys: 0, lintFindings: 0 },
  });

  const { overall, sections } = summarize(production);
  const verdict = Object.fromEntries(sections.map((s) => [s.title, s.verdict]));

  assert.equal(overall, 'broken');
  assert.equal(verdict.Content, 'broken', '9.7% processed is a fraction of what it was given');
  assert.equal(verdict.Failures, 'broken', '2,024 rows the retry system cannot see');
  assert.equal(verdict.Runs, 'healthy', 'yet the runs that do happen succeed');
  assert.equal(verdict.Bank, 'attention', 'facts, but no links and no live patterns');
});

test('unclassified failures are broken, whatever caused them', () => {
  // The stranded-backlog signature. A failure the retry system does not
  // understand is never looked at again, so it does not recover on its own.
  const s = failureSection(snapshot({
    content: { failed: 5, failedByKind: { transient: 0, terminal: 0, not_applicable: 0, unclassified: 5 } },
  }).content);
  assert.equal(s.verdict, 'broken');
  assert.match(s.headline, /never be retried/);
});

test('transient failures are normal operation, because they heal themselves', () => {
  // An earlier version flagged every failure as "attention", which made a
  // healthy overall verdict nearly unreachable -- every real system has some.
  // A report that always cries wolf gets ignored.
  const s = failureSection(snapshot({
    content: { failed: 3, failedByKind: { transient: 3, terminal: 0, not_applicable: 0, unclassified: 0 } },
  }).content);
  assert.equal(s.verdict, 'healthy');
  assert.match(s.headline, /retry on their own/);
});

test('terminal failures need a person, so they are flagged', () => {
  // Resending will not fix these. They are the only failures nobody else will
  // deal with.
  const s = failureSection(snapshot({
    content: { failed: 3, failedByKind: { transient: 2, terminal: 1, not_applicable: 0, unclassified: 0 } },
  }).content);
  assert.equal(s.verdict, 'attention');
  assert.match(s.headline, /need a look/);
});

test('when every "failure" is a correct skip, that is healthy', () => {
  const s = failureSection(snapshot({
    content: { failed: 4, failedByKind: { transient: 0, terminal: 0, not_applicable: 4, unclassified: 0 } },
  }).content);
  assert.equal(s.verdict, 'healthy');
});

test('content between half and the threshold is attention; below half is broken', () => {
  assert.equal(contentSection(snapshot({ content: { total: 100, completed: 70, withEmbedding: 95 } }).content).verdict, 'attention');
  assert.equal(contentSection(snapshot({ content: { total: 100, completed: 30, withEmbedding: 95 } }).content).verdict, 'broken');
  assert.equal(contentSection(snapshot().content).verdict, 'healthy');
});

test('low embedding coverage alone is enough to flag content', () => {
  // Everything processed, nothing searchable: search cannot work, whatever the
  // index does.
  const s = contentSection(snapshot({ content: { total: 100, completed: 100, withEmbedding: 1 } }).content);
  assert.equal(s.verdict, 'attention');
  assert.match(s.headline, /searchable/);
});

test('no extraction stats is "no data", never a perfect score', () => {
  // A 0% drop rate would read as flawless extraction. Before any stats are
  // recorded, the honest answer is that nothing can be said.
  const s = extractionSection(snapshot({ runs: { extraction: { candidates: 0, written: 0, dropped: 0, dropReasons: {} } } }).runs);
  assert.equal(s.verdict, 'no data');
});

test('a high drop rate asks for a look at the reasons', () => {
  const s = extractionSection(snapshot({
    runs: { extraction: { candidates: 10, written: 3, dropped: 7, dropReasons: { excerpt_not_found: 7 } } },
  }).runs);
  assert.equal(s.verdict, 'attention');
  assert.ok(s.lines.some((l) => l.includes('excerpt_not_found 7')), 'the reasons are shown, not just the total');
});

test('a quiet system is "no data", not broken', () => {
  // No recent runs could mean idle or dead. The report says so rather than
  // guessing which.
  const s = runsSection(snapshot({ runs: { recentCompleted: 0, recentFailed: 0 } }).runs);
  assert.equal(s.verdict, 'no data');
  assert.match(s.headline, /quiet, or not running/);
});

test('mostly-failing runs are broken', () => {
  assert.equal(runsSection(snapshot({ runs: { recentCompleted: 2, recentFailed: 8 } }).runs).verdict, 'broken');
  assert.equal(runsSection(snapshot({ runs: { recentCompleted: 8, recentFailed: 2 } }).runs).verdict, 'attention');
});

test('an empty bank is "no data"; a bank with only unlinked facts needs attention', () => {
  assert.equal(bankSection(snapshot({ bank: { assertions: 0 } }).bank).verdict, 'no data');
  assert.equal(bankSection(snapshot({ bank: { patternsLive: 0, relations: 0 } }).bank).verdict, 'attention');
});

test('overall is the worst section, and "no data" never counts against it', () => {
  const healthy = summarize(snapshot());
  assert.equal(healthy.overall, 'healthy');

  // An idle system with nothing to report is not unhealthy.
  const idle = summarize(snapshot({ runs: { recentCompleted: 0, recentFailed: 0 } }));
  assert.equal(idle.overall, 'healthy');
});
