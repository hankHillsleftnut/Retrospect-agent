import { Router } from 'express';
import { handleCorrection } from '../corrections/target';
import { applyCorrection } from '../corrections/apply';
import type { ClaimKind } from '../brain/lineage';

/**
 * Corrections in plain words (goal 20). The app sends what the person said;
 * it is applied when the target is unambiguous, otherwise the likely claims
 * come back for one tap of confirmation.
 */
export const correctionsRouter = Router();

/** POST /corrections { userId, text } */
correctionsRouter.post('/', async (req, res) => {
  const { userId, text } = req.body ?? {};
  if (!userId || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'userId and text required' });
  try { const { usage, ...result } = await handleCorrection(userId, text.trim()); void usage; return res.json(result); }
  catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

const KINDS = new Set<ClaimKind>(['fact', 'answer', 'pattern', 'why']);

/** POST /corrections/confirm { userId, kind, id, note? }: the person picked which claim they meant. */
correctionsRouter.post('/confirm', async (req, res) => {
  const { userId, kind, id, note } = req.body ?? {};
  if (!userId || !KINDS.has(kind) || typeof id !== 'string') return res.status(400).json({ error: 'userId, kind and id required' });
  try { const plan = await applyCorrection(userId, { kind, id }, { note: typeof note === 'string' ? note : undefined }); return res.json({ outcome: 'applied', retired: plan.retire.length }); }
  catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});
