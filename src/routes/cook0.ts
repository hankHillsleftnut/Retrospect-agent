import { Router } from 'express';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { runCook0, applyCook0Decisions, writeNewDocumentVersion } from '../agents/cook0-agent';
import { Trace } from '../pipelines/trace';
import type { DbUserUnderstanding, UserUnderstandingDocument } from '../types';

export const cook0Router = Router();

/**
 * POST /cook0/run
 * Body: { userId: string, notes?: string }
 *
 * Standalone Cook 0 trigger. Reads all active identity inferences for the
 * user, runs Cook 0 against them, writes a new document version. Does NOT
 * re-ingest raw_content. Useful for:
 *   - recovering from a Cook 0 failure during ingestion
 *   - iterating on the Cook 0 system prompt
 *   - regenerating the document after promoting/retiring inferences manually
 */
cook0Router.post('/run', async (req, res) => {
  const { userId, notes } = (req.body ?? {}) as { userId?: string; notes?: string };
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const trace = await Trace.start({
    userId,
    kind: 'ingest', // existing trace kind; standalone cook0 runs reuse it for now
    triggeredBy: 'http',
    notes: notes ?? 'standalone cook0 rerun (no re-ingestion)',
  });

  try {
    // 1. Load current document (if any) and all active inferences.
    const [understandingRes, activeInfRes] = await Promise.all([
      supabase
        .from(Tables.USER_UNDERSTANDING)
        .select('*')
        .eq('user_id', userId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from(Tables.IDENTITY_INFERENCES)
        .select('id')
        .eq('user_id', userId)
        .is('superseded_by', null)
        .is('retired_at', null),
    ]);

    const currentUnderstanding =
      (understandingRes.data ?? null) as DbUserUnderstanding | null;
    const currentDocument: UserUnderstandingDocument | null =
      currentUnderstanding?.document ?? null;
    const activeInferenceIds = (activeInfRes.data ?? []).map((r) => r.id as string);

    if (activeInferenceIds.length === 0) {
      await trace.complete();
      return res.json({
        traceId: trace.id,
        ok: false,
        reason: 'No active identity inferences for this user — nothing to synthesize.',
      });
    }

    // 2. Snapshot inputs into the trace.
    if (trace.id) {
      await supabase
        .from(Tables.PIPELINE_RUN_TRACES)
        .update({
          inputs_snapshot: {
            standalone_cook0: true,
            active_inference_ids: activeInferenceIds,
            prior_understanding_version: currentUnderstanding?.version ?? null,
          },
        })
        .eq('id', trace.id);
    }

    trace.setIdentityInferenceIds(activeInferenceIds);

    // 3. Run Cook 0 — treat all active inferences as "new" so Cook 0 has the
    //    full set to read. (It's idempotent — if the document already covers
    //    them, the new doc will be near-identical.)
    const result = await runCook0({
      userId,
      currentDocument,
      newInferenceIds: activeInferenceIds,
      trace,
    });

    await applyCook0Decisions(result);

    // 4. Re-snapshot active ids (some may have just been retired by Cook 0)
    const { data: postRows } = await supabase
      .from(Tables.IDENTITY_INFERENCES)
      .select('id')
      .eq('user_id', userId)
      .is('superseded_by', null)
      .is('retired_at', null);
    const postActiveIds = (postRows ?? []).map((r) => r.id as string);

    const version = await writeNewDocumentVersion({
      userId,
      document: result.document,
      generationNotes: result.generation_notes,
      inferenceIdsAtVersion: postActiveIds,
      sourceIngestionRunId: trace.id,
    });

    trace.setUserUnderstanding(result.document, version);
    await trace.complete();

    return res.json({
      traceId: trace.id,
      ok: true,
      user_understanding_version: version,
      promoted_count: result.promote_inference_ids.length,
      retired_count: result.retire_inferences.length,
      generation_notes: result.generation_notes,
    });
  } catch (err) {
    await trace.fail(err);
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err), traceId: trace.id });
  }
});
