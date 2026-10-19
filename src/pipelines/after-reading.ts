/**
 * What runs once every entry in an ingest run has been read.
 *
 * Two independent steps, each unable to fail the run:
 *   - runCook0Step: the old portrait rewrite from identity inferences. Retired
 *     with the old framework (architecture §6b); in facts mode it is skipped.
 *   - consolidateFacts: patterns, then whys, then the portrait, from facts.
 *
 * Moved out of runIngest unchanged.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { runPromoter, type PromoterRunResult } from '../brain/run-promoter';
import { buildPortrait, patchDocument } from '../brain/portrait';
import { runCook0, applyCook0Decisions, writeNewDocumentVersion } from '../agents/cook0-agent';
import type { Trace } from './trace';
import type { UserUnderstandingDocument } from '../types';

export interface Cook0StepResult {
  /** New document version, or null when skipped or failed. */
  version: number | null;
  failed: boolean;
  error?: string;
}

/**
 * Cook 0 — rewrite the User Understanding Document.
 * A failure does NOT undo observations/insights/inferences. The document just
 * stays at its previous version and the failure is recorded on the trace.
 */
export async function runCook0Step(input: {
  userId: string;
  currentDocument: UserUnderstandingDocument | null;
  currentVersion: number;
  newInferenceIds: string[];
  trace: Trace;
}): Promise<Cook0StepResult> {
  const { userId, currentDocument, newInferenceIds, trace } = input;

  // In facts mode no identity inferences are produced, so there is nothing
  // new for Cook 0 to fold in; rewriting the portrait anyway would cost a
  // call per ingest to say the same thing. The portrait is still patched
  // from live facts by consolidateFacts.
  const skipCook0 = config.extraction.mode !== 'legacy' && newInferenceIds.length === 0;
  if (skipCook0) return { version: null, failed: false };

  try {
    const cook0Result = await runCook0({ userId, currentDocument, newInferenceIds, trace });

    await applyCook0Decisions(cook0Result);

    const { data: activeRows } = await supabase
      .from(Tables.IDENTITY_INFERENCES)
      .select('id')
      .eq('user_id', userId)
      .is('superseded_by', null)
      .is('retired_at', null);
    const activeInferenceIds = (activeRows ?? []).map((r) => r.id);

    const version = await writeNewDocumentVersion({
      userId,
      document: cook0Result.document,
      generationNotes: cook0Result.generation_notes,
      inferenceIdsAtVersion: activeInferenceIds,
      sourceIngestionRunId: trace.id,
    });

    trace.setUserUnderstanding(cook0Result.document, version);
    return { version, failed: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(
      `[ingest] Cook 0 failed for user ${userId}: ${error}. ` +
        `Observations/insights/inferences were persisted; document stays at v${input.currentVersion}.`
    );
    trace.setCook0Failure(error);
    return { version: null, failed: true, error };
  }
}

/**
 * Patterns, then whys, then the portrait -- in that order, because each
 * can only exist once the one before it does. Returns the promoter's result,
 * or null if it failed.
 */
export async function consolidateFacts(userId: string, trace: Trace): Promise<PromoterRunResult | null> {
  let promoterResult: PromoterRunResult | null = null;
  try {
    promoterResult = await runPromoter({ userId, sourceRunId: trace.id });
    console.log(
      `[ingest] patterns: ${promoterResult.created} new, ${promoterResult.promoted} promoted, ` +
        `${promoterResult.demoted} demoted, ${promoterResult.whysCreated} whys`
    );
  } catch (err) {
    // Facts are already safe; a promoter failure costs this run's patterns,
    // not the evidence. The next run recomputes from the same facts.
    console.error(`[ingest] promoter FAILED: ${(err as Error).message}`);
  }

  try {
    const portrait = await buildPortrait(userId);
    const { data: latest } = await supabase.from(Tables.USER_UNDERSTANDING)
      .select('document,version').eq('user_id', userId)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    const patched = patchDocument((latest?.document as any) ?? null, portrait);
    await supabase.from(Tables.USER_UNDERSTANDING).upsert({
      user_id: userId,
      document: patched,
      version: (latest?.version ?? 0) + 1,
    });
    console.log(`[ingest] portrait rebuilt (${portrait.emptySlots.length} slot(s) left empty)`);
  } catch (err) {
    console.error(`[ingest] portrait rebuild FAILED: ${(err as Error).message}`);
  }
  return promoterResult;
}
