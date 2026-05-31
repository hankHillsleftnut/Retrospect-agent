import { Router } from 'express';
import { runIngest } from '../pipelines/ingest';
import { runSocialResearch } from '../pipelines/social-research';

export const ingestRouter = Router();

/**
 * POST /ingest/run
 * Body: { userId: string, daysBack?: number, rawContentIds?: string[], dryRun?: boolean, notes?: string }
 */
ingestRouter.post('/run', async (req, res) => {
  const { userId, daysBack, rawContentIds, dryRun, notes } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const result = await runIngest({
      userId,
      daysBack,
      rawContentIds,
      dryRun: !!dryRun,
      triggeredBy: 'http',
      notes,
    });
    return res.json(result);
  } catch (err) {
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /ingest/social-research
 * Fire web research on social handles and ingest the findings.
 * Body: { userId: string, handles: [{ platform: string, handle: string }] }
 */
ingestRouter.post('/social-research', async (req, res) => {
  const { userId, handles } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (!Array.isArray(handles) || handles.length === 0) {
    return res.status(400).json({ error: 'handles array required' });
  }
  try {
    const result = await runSocialResearch({ userId, handles, triggeredBy: 'http' });
    return res.json(result);
  } catch (err) {
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /ingest/backfill
 * Reprocess all failed/pending content for a user over a wider time window.
 * Body: { userId: string, daysBack?: number }
 */
ingestRouter.post('/backfill', async (req, res) => {
  const { userId, daysBack } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const result = await runIngest({
      userId,
      daysBack: daysBack ?? 30,
      triggeredBy: 'http',
      notes: 'backfill — reprocessing failed/pending content',
    });
    return res.json(result);
  } catch (err) {
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});
