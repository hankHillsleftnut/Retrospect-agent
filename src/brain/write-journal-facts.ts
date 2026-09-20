/**
 * Journal FactCandidates -> graph Facts.
 *
 * This is a MAPPER, not a second write path. Everything goes through
 * writeFact so journals and integrations can never drift apart (05 D3).
 *
 * The contract, in order:
 *   1. verify the excerpt against the source, or drop the claim
 *   2. resolve the subject to an entity (Self reuses the existing alias)
 *   3. build a deterministic origin key so a retry upserts
 *   4. write the Fact with raw_content evidence and span offsets
 */

import { writeFact, resolveEntity } from '../pipelines/graph-v2';
import { verifyExcerpt } from './verify-span';
import type { FactCandidate } from '../types';

export interface JournalFactSource {
  id: string;
  content: string;
  content_type: string;
  content_date?: string | null;
}

export interface WriteJournalFactsResult {
  written: number;
  /** Claims discarded because the quote was not in the source. The health
   *  number for extraction: a high drop rate means the prompt is wrong, not
   *  the verifier. */
  dropped: number;
  dropReasons: Record<string, number>;
  assertionIds: string[];
  /** Candidates where the user named their own loop -- seeds for the promoter. */
  selfNamedLoops: string[];
}

/** Stable, boring object text so the same claim always yields the same key. */
export function normalizeObject(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'‘’“”]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function buildOriginKey(rawContentId: string, predicate: string, object: string): string {
  return `journal:${rawContentId}:${predicate}:${normalizeObject(object)}`;
}

/** Quotations are the one place a bad transcript does real damage. */
const QUOTE_PREDICATES = new Set(['said_about_self']);

export async function writeJournalFacts(options: {
  userId: string;
  candidates: FactCandidate[];
  sources: JournalFactSource[];
  sourceRunId?: string | null;
  modelVersion?: string | null;
  /** Transcription confidence per source id, when the client sends it. */
  transcriptionConfidence?: Record<string, number>;
  minTranscriptionConfidenceForQuotes?: number;
}): Promise<WriteJournalFactsResult> {
  const result: WriteJournalFactsResult = {
    written: 0,
    dropped: 0,
    dropReasons: {},
    assertionIds: [],
    selfNamedLoops: [],
  };
  if (options.candidates.length === 0) return result;

  const drop = (reason: string) => {
    result.dropped += 1;
    result.dropReasons[reason] = (result.dropReasons[reason] ?? 0) + 1;
  };

  const selfEntityId = await resolveEntity({
    userId: options.userId,
    entityType: 'identity',
    canonicalName: 'Self',
    aliases: [{ namespace: 'retrospect:user', alias: options.userId }],
  });

  const quoteFloor = options.minTranscriptionConfidenceForQuotes ?? 0.8;

  for (const candidate of options.candidates) {
    const source = options.sources[candidate.source_index];
    if (!source) {
      drop('unknown_source_index');
      continue;
    }

    const span = verifyExcerpt(candidate.excerpt ?? '', source.content);
    if (!span.ok) {
      drop(span.reason);
      continue;
    }

    // A misheard quotation is worse than no quotation: it puts words in
    // someone's mouth and then repeats them back. Facts about what HAPPENED
    // survive a shaky transcript; quotations do not.
    const confidence = options.transcriptionConfidence?.[source.id];
    if (
      QUOTE_PREDICATES.has(candidate.predicate) &&
      typeof confidence === 'number' &&
      confidence < quoteFloor
    ) {
      drop('low_confidence_transcript_quote');
      continue;
    }

    let subjectEntityId = selfEntityId;
    if (candidate.subject && candidate.subject.toLowerCase() !== 'self') {
      subjectEntityId = await resolveEntity({
        userId: options.userId,
        entityType: 'person',
        canonicalName: candidate.subject.trim(),
        // Namespaced so a journal name never silently merges with an
        // email or calendar identity. First-name-only merging is exactly
        // how two different Alexes become one person (05, 01 test 4).
        aliases: [{ namespace: 'journal:name', alias: candidate.subject.trim().toLowerCase() }],
      });
    }

    const assertionId = await writeFact({
      userId: options.userId,
      subjectEntityId,
      predicate: candidate.predicate,
      objectValue: {
        text: candidate.object,
        normalized: normalizeObject(candidate.object),
      },
      originKey: buildOriginKey(source.id, candidate.predicate, candidate.object),
      kind: 'observed',
      confidence: 1,
      eventTime: candidate.event_time ?? source.content_date ?? null,
      modelVersion: options.modelVersion ?? null,
      sourceRunId: options.sourceRunId ?? null,
      metadata: {
        raw_content_id: source.id,
        content_type: source.content_type,
        severity_hint: candidate.severity_hint ?? 'standard',
        names_own_loop: candidate.names_own_loop === true,
      },
      evidence: [
        {
          rawContentId: source.id,
          excerpt: span.matchedText,
          charStart: span.charStart,
          charEnd: span.charEnd,
          role: 'supports',
        },
      ],
    });

    result.written += 1;
    result.assertionIds.push(assertionId);
    if (candidate.names_own_loop === true) result.selfNamedLoops.push(assertionId);
  }

  return result;
}
