/**
 * What one read batch leaves behind: its facts, and a search vector for each
 * entry. Moved out of runIngest unchanged; neither can fail the run.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { generateEmbeddings } from '../services/embeddings';
import { writeJournalFacts } from '../brain/write-journal-facts';
import type { Trace } from './trace';
import type { DbRawContent } from '../types';

export interface BatchFactsResult {
  written: number;
  dropped: number;
  dropReasons: Record<string, number>;
  selfNamedLoops: string[];
  /** Set when the write failed; the batch still completes. */
  error?: string;
}

/**
 * Facts FIRST. The graph is the bank; the old framework's tables are a
 * compatibility shim. A claim whose quote is not in the source is dropped here
 * and never reaches the graph.
 */
export async function writeBatchFacts(input: {
  userId: string;
  batch: DbRawContent[];
  candidates: unknown[];
  sourceRunId: string | null | undefined;
}): Promise<BatchFactsResult> {
  const { userId, batch, candidates } = input;
  const none: BatchFactsResult = { written: 0, dropped: 0, dropReasons: {}, selfNamedLoops: [] };
  if (candidates.length === 0) return none;
  try {
    const factResult = await writeJournalFacts({
      userId,
      candidates: candidates as Parameters<typeof writeJournalFacts>[0]['candidates'],
      sources: batch.map((rc) => ({
        id: rc.id,
        content: rc.content,
        content_type: rc.content_type,
        content_date: rc.content_date,
      })),
      sourceRunId: input.sourceRunId,
      transcriptionConfidence: Object.fromEntries(
        batch
          .map((rc) => {
            const meta = (rc.metadata ?? {}) as Record<string, unknown>;
            const c = meta.transcription_confidence;
            return typeof c === 'number' ? [rc.id, c] : null;
          })
          .filter((e): e is [string, number] => e !== null)
      ),
    });
    console.log(
      `[ingest]     facts: ${factResult.written} written, ${factResult.dropped} dropped` +
        (factResult.dropped > 0 ? ` (${JSON.stringify(factResult.dropReasons)})` : '')
    );
    return {
      written: factResult.written,
      dropped: factResult.dropped,
      dropReasons: factResult.dropReasons,
      selfNamedLoops: factResult.selfNamedLoops,
    };
  } catch (err) {
    // A graph failure must not lose the batch: the rest still persists, and
    // the origin keys make a retry safe.
    const error = (err as Error).message;
    console.error(`[ingest]     facts FAILED: ${error}`);
    return { ...none, error };
  }
}

/**
 * Embed the SOURCE, not just the derived rows. 0.4% of raw_content carried an
 * embedding at audit, which made search_raw_content dead. Facts do not need
 * this to exist; fallback search does. Returns how many entries were embedded.
 */
export async function embedSources(batch: DbRawContent[], trace: Trace): Promise<number> {
  let embedded = 0;
  try {
    const toEmbed = batch.filter((row) => !row.embedding && row.content?.trim());
    if (toEmbed.length > 0) {
      const vectors = await generateEmbeddings(toEmbed.map((row) => row.content.slice(0, 8000)));
      trace.addCost({
        embedding_tokens: toEmbed.reduce((acc, r) => acc + r.content.length / 4, 0),
      });
      for (let i = 0; i < toEmbed.length; i++) {
        const vector = vectors[i];
        if (!vector) continue;
        await supabase.from(Tables.RAW_CONTENT).update({ embedding: vector }).eq('id', toEmbed[i]!.id);
        embedded += 1;
      }
    }
  } catch (err) {
    // Never fail a batch over search hygiene.
    console.warn(`[ingest]     raw embedding failed: ${(err as Error).message}`);
  }
  return embedded;
}
