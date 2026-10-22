import { Router } from 'express';
import { config } from '../config';
import { searchPerson } from '../search/search';
import { searchAndAnswer as searchAndAnswerEngine } from '../search/answer';
import { openSource, type SourceKind } from '../search/source';
import { checkDailySpend, spendLimitedBody } from '../pipelines/spend-guard';
import { recordSpend, usageLines } from '../pipelines/spend-ledger';

/**
 * Search for the app (S1.2b), in the founder's shape: sources come back fast,
 * "what we found" follows, and any source opens in full.
 */
export interface SearchDeps {
  searchAndAnswer: typeof searchAndAnswerEngine;
  checkSpend: typeof checkDailySpend;
  recordSpend: typeof recordSpend;
}

export function makeSearchRouter(deps: Partial<SearchDeps> = {}): Router {
  const d: SearchDeps = { searchAndAnswer: searchAndAnswerEngine, checkSpend: checkDailySpend, recordSpend, ...deps };
  const router = Router();

  /** POST /search/sources { userId, q } -- the matching sources, quickly (~1 s). A read: never refused. */
  router.post('/sources', async (req, res) => {
    const { userId, q } = req.body ?? {};
    if (!userId || typeof q !== 'string' || !q.trim()) return res.status(400).json({ error: 'userId and q required' });
    try { return res.json({ query: q, sources: await searchPerson(userId, q, { limit: 15 }) }); }
    catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  /** POST /search/answer { userId, q } -- "what we found", with numbered sources. */
  router.post('/answer', async (req, res) => {
    const { userId, q } = req.body ?? {};
    if (!userId || typeof q !== 'string' || !q.trim()) return res.status(400).json({ error: 'userId and q required' });
    try {
      // The cap comes first: over it, no model is called (BEA.4).
      const spend = await d.checkSpend(userId);
      if (!spend.allowed) return res.status(429).json(spendLimitedBody(spend));
      const { usage, ...result } = await d.searchAndAnswer(userId, q);
      await d.recordSpend(userId, 'search', usageLines([
        { model: config.anthropic.timeCategoryModel, usage: usage.rewrite },
        { model: config.anthropic.writerModel, usage: usage.write },
        { model: config.anthropic.guardModel, usage: usage.guard },
      ]));
      return res.json(result);
    } catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
  });

  /** GET /search/:userId/source/:kind/:id -- one source in full; only ever the person's own. */
  router.get('/:userId/source/:kind/:id', async (req, res) => {
    const kind = req.params.kind as SourceKind;
    if (!['item', 'fact', 'answer', 'saved'].includes(kind)) return res.status(400).json({ error: 'unknown kind' });
    const source = await openSource(req.params.userId, kind, req.params.id);
    return source ? res.json({ source }) : res.status(404).json({ error: 'not found' });
  });

  return router;
}

export const searchRouter = makeSearchRouter();
