/**
 * Scoring the extractor against the test bank.
 *
 * The test bank (test-bank/, local and never committed) is the founder's own
 * writing, each entry paired with the facts a correct extractor should produce
 * and the tempting conclusions it must not. This turns one extractor run into
 * the two numbers the Phase 3 brief declared before any change was made:
 *
 *   recall          -- of the facts that should come out, how many did;
 *   false positives -- conclusions produced that the bank says are wrong.
 *
 * A change wins only by raising recall without raising false positives
 * (brief-goal-03-making-meaning.md). Pure functions here; the run and the
 * model-judged part live in scripts/bank-score.ts.
 */

import { verifyExcerpt } from '../brain/verify-span';

export interface ExpectedFact { claim: string; domain?: string; excerpt: string }
export interface Forbidden { claim: string; why: string }

export interface BankExpectation {
  entry: string;
  authorship: string;
  cases: string[];
  should_extract: ExpectedFact[];
  should_not_extract: Forbidden[];
  notes?: string;
  status?: string;
}

export interface Candidate {
  subject: string;
  predicate: string;
  object: string;
  excerpt: string;
}

/** Where a quote sits in the entry, or null if it is not really there. */
export function locate(excerpt: string, text: string): [number, number] | null {
  const found = verifyExcerpt(excerpt, text);
  return found.ok ? [found.charStart, found.charEnd] : null;
}

/**
 * Does an extracted fact cover an expected one? Judged by where their quotes
 * sit in the entry: they must overlap by at least half of the shorter quote.
 * Position, not wording, because the same fact is often quoted a few words
 * longer or shorter -- and two different facts rarely share most of a quote.
 */
export function covers(candidate: [number, number], expected: [number, number]): boolean {
  const overlap = Math.min(candidate[1], expected[1]) - Math.max(candidate[0], expected[0]);
  const shorter = Math.min(candidate[1] - candidate[0], expected[1] - expected[0]);
  return shorter > 0 && overlap >= shorter / 2;
}

export interface EntryScore {
  entry: string;
  cases: string[];
  expected: number;
  found: string[];
  missed: string[];
  candidates: number;
  /** Candidates whose quote is not in the entry: the pipeline would drop them. */
  unverifiable: number;
  /** Indices (into verified candidates) a judge said match a forbidden claim. */
  falsePositives: { candidate: Candidate; matches: string }[];
}

/** Recall for one entry, from the verified candidates. */
export function scoreRecall(text: string, expected: ExpectedFact[], candidates: Candidate[]): {
  verified: { candidate: Candidate; span: [number, number] }[];
  unverifiable: number;
  found: string[];
  missed: string[];
} {
  const verified: { candidate: Candidate; span: [number, number] }[] = [];
  let unverifiable = 0;
  for (const c of candidates) {
    const span = locate(c.excerpt ?? '', text);
    if (span) verified.push({ candidate: c, span });
    else unverifiable += 1;
  }
  const found: string[] = [];
  const missed: string[] = [];
  for (const e of expected) {
    const target = locate(e.excerpt, text);
    const hit = target !== null && verified.some((v) => covers(v.span, target));
    (hit ? found : missed).push(e.claim);
  }
  return { verified, unverifiable, found, missed };
}

/**
 * Candidates that make a claim about the user from words that are not theirs.
 * Deterministic: for an entry the bank marks as someone else's, any fact whose
 * subject is the user is wrong by construction -- no judge needed.
 */
export function attributedFromOthers(authorship: string, candidates: Candidate[]): Candidate[] {
  if (!/^other\b/i.test(authorship.trim())) return [];
  return candidates.filter((c) => /^self$/i.test(c.subject.trim()));
}

export interface BankTotals {
  entries: number;
  expected: number;
  found: number;
  recall: number;
  candidates: number;
  unverifiable: number;
  falsePositives: number;
}

export function totals(scores: EntryScore[]): BankTotals {
  const expected = scores.reduce((n, s) => n + s.expected, 0);
  const found = scores.reduce((n, s) => n + s.found.length, 0);
  return {
    entries: scores.length,
    expected,
    found,
    recall: expected ? Math.round((found / expected) * 100) / 100 : 0,
    candidates: scores.reduce((n, s) => n + s.candidates, 0),
    unverifiable: scores.reduce((n, s) => n + s.unverifiable, 0),
    falsePositives: scores.reduce((n, s) => n + s.falsePositives.length, 0),
  };
}
