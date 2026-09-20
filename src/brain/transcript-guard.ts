/**
 * What the writer is allowed to say, enforced rather than requested.
 *
 * Cook C may name no Pattern whose id is not in the evidence pack (01
 * acceptance test 9). Before this, that rule was an instruction in a prompt
 * and a test after the fact; here it is checkable at write time, and every
 * sentence records what it was built from.
 *
 * docs/second-brain/14 (lineage), 09 A11.
 */

import { validateCitations, type EvidencePack } from './evidence-pack';

export interface TranscriptSegment {
  text: string;
  cites?: {
    patternIds?: string[];
    assertionIds?: string[];
    whyIds?: string[];
    gap?: string;
  };
}

export interface CitedTranscript {
  segments: TranscriptSegment[];
}

export type GuardViolation =
  | { kind: 'unknown_pattern'; segmentIndex: number; ids: string[] }
  | { kind: 'unknown_assertion'; segmentIndex: number; ids: string[] }
  | { kind: 'prediction'; segmentIndex: number; match: string }
  | { kind: 'missing_gap_disclosure'; expected: string[] };

export interface GuardResult {
  ok: boolean;
  violations: GuardViolation[];
  /** Share of segments that point at something real. */
  groundednessRate: number;
  citedSegments: number;
  totalSegments: number;
}

/**
 * Forecasting is out of scope -- the founder did not select it (05 D8).
 * Matched on phrasing rather than meaning, so it is a blunt instrument that
 * errs toward flagging. A false positive costs a rewrite; a false negative
 * ships a prediction.
 */
const PREDICTION_PATTERNS: RegExp[] = [
  /\byou(?:'| a)?ll (?:probably |likely |almost certainly )?(?:skip|avoid|cancel|struggle|fail|do|feel)\b/i,
  /\bnext week you(?:'| wi)?ll\b/i,
  /\bby (?:next|this coming) (?:week|month)\b.{0,40}\byou will\b/i,
  /\bmy prediction\b/i,
  /\bI predict\b/i,
  /\byou're going to (?:skip|avoid|cancel|struggle|fail)\b/i,
];

export function findPrediction(text: string): string | null {
  for (const re of PREDICTION_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Check a finished transcript against the pack it was built from.
 *
 * Uncited segments are ALLOWED -- transitions, framing and questions are not
 * claims. They are counted instead, because a transcript that is mostly
 * uncited is mostly improvisation, and that should be a number rather than a
 * feeling.
 */
export function guardTranscript(options: {
  transcript: CitedTranscript;
  pack: EvidencePack;
  requireGapDisclosure?: boolean;
}): GuardResult {
  const violations: GuardViolation[] = [];
  const segments = options.transcript.segments ?? [];
  let cited = 0;

  segments.forEach((segment, index) => {
    const cites = segment.cites ?? {};
    const hasCitation =
      (cites.patternIds?.length ?? 0) > 0 ||
      (cites.assertionIds?.length ?? 0) > 0 ||
      (cites.whyIds?.length ?? 0) > 0 ||
      Boolean(cites.gap);
    if (hasCitation) cited += 1;

    const check = validateCitations(options.pack, {
      patternIds: cites.patternIds,
      assertionIds: cites.assertionIds,
    });
    if (check.unknownPatternIds.length > 0) {
      violations.push({ kind: 'unknown_pattern', segmentIndex: index, ids: check.unknownPatternIds });
    }
    if (check.unknownAssertionIds.length > 0) {
      violations.push({ kind: 'unknown_assertion', segmentIndex: index, ids: check.unknownAssertionIds });
    }

    const prediction = findPrediction(segment.text);
    if (prediction) {
      violations.push({ kind: 'prediction', segmentIndex: index, match: prediction });
    }
  });

  // Gaps are product, not polish. If the bank knows it is missing something,
  // the episode says so rather than filling the silence with invention.
  if (options.requireGapDisclosure !== false && options.pack.gaps.length > 0) {
    const spoken = segments.some((s) => Boolean(s.cites?.gap));
    if (!spoken) {
      violations.push({ kind: 'missing_gap_disclosure', expected: options.pack.gaps });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    groundednessRate: segments.length === 0 ? 0 : Number((cited / segments.length).toFixed(3)),
    citedSegments: cited,
    totalSegments: segments.length,
  };
}

/** Flatten cited segments into the plain text TTS needs. */
export function renderTranscript(transcript: CitedTranscript): string {
  return (transcript.segments ?? []).map((s) => s.text.trim()).filter(Boolean).join('\n\n');
}
