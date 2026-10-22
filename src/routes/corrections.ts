import { Router } from 'express';
import { config } from '../config';
import { handleCorrection as handleCorrectionEngine } from '../corrections/target';
import { applyCorrection } from '../corrections/apply';
import { claimBelongsTo, type ClaimKind } from '../brain/lineage';
import { checkDailySpend, spendLimitedBody } from '../pipelines/spend-guard';
import { recordSpend, usageLines } from '../pipelines/spend-ledger';

/**
 * Corrections in plain words (goal 20). The app sends what the person said;
 * it is applied when the target is unambiguous, otherwise the likely claims
 * come back for one tap of confirmation.
 */
export interface CorrectionsDeps {
  handleCorrection: typeof handleCorrectionEngine;
  checkSpend: typeof checkDailySpend;
  recordSpend: typeof recordSpend;
}

const KINDS = new Set<ClaimKind>(['fact', 'answer', 'pattern', 'why']);

export function makeCorrectionsRouter(deps: Partial<CorrectionsDeps> = {}): Router {
  const d: CorrectionsDeps = { handleCorrection: handleCorrectionEngine, checkSpend: checkDailySpend, recordSpend, ...deps };
  const router = Router();

  /** POST /corrections { userId, text } */
  router.post('/', async (req, res) => {
    const { userId, text } = req.body ?? {};
    if (!userId || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'userId and text required' });
    try {
      // The cap comes first: over it, no model is called (BEA.4).
      const spend = await d.checkSpend(userId);
      if (!spend.allowed) return res.status(429).json(spendLimitedBody(spend));
      const { usage, ...result } = await d.handleCorrection(userId, text.trim());
      await d.recordSpend(userId, 'correction', usageLines([{ model: config.anthropic.writerModel, usage }]));
      return res.json(result);
    } catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  /**
   * POST /corrections/confirm { userId, kind, id, note?, mode? }: the person picked which claim
   * they meant. mode "changed" (true then, not now) retires it without blacklisting; "wrong" (default) rejects it.
   * No model call: applying is deterministic, so the cap does not apply.
   */
  router.post('/confirm', async (req, res) => {
    const { userId, kind, id, note, mode } = req.body ?? {};
    if (!userId || !KINDS.has(kind) || typeof id !== 'string') return res.status(400).json({ error: 'userId, kind and id required' });
    try {
      // The agent trusts the user id it is sent: refuse a claim that isn't theirs, before planning (BEA.2).
      if (!(await claimBelongsTo(userId, { kind, id }))) return res.status(404).json({ error: 'not found' });
      const plan = await applyCorrection(userId, { kind, id }, { note: typeof note === 'string' ? note : undefined, mode: mode === 'changed' ? 'changed' : 'wrong' }); return res.json({ outcome: 'applied', retired: plan.retire.length }); }
    catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  return router;
}

export const correctionsRouter = makeCorrectionsRouter();
