import { Router } from 'express';
import { runIngest } from '../pipelines/ingest';

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
