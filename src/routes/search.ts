import { Router } from 'express';
import { searchPerson } from '../search/search';
import { searchAndAnswer } from '../search/answer';
import { openSource, type SourceKind } from '../search/source';

/**
 * Search for the app (S1.2b), in the founder's shape: sources come back fast,
 * "what we found" follows, and any source opens in full.
 */
export const searchRouter = Router();

/** POST /search/sources { userId, q } -- the matching sources, quickly (~1 s). */
searchRouter.post('/sources', async (req, res) => {
  const { userId, q } = req.body ?? {};
  if (!userId || typeof q !== 'string' || !q.trim()) return res.status(400).json({ error: 'userId and q required' });
  try { return res.json({ query: q, sources: await searchPerson(userId, q, { limit: 15 }) }); }
  catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

/** POST /search/answer { userId, q } -- "what we found", with numbered sources. */
searchRouter.post('/answer', async (req, res) => {
  const { userId, q } = req.body ?? {};
  if (!userId || typeof q !== 'string' || !q.trim()) return res.status(400).json({ error: 'userId and q required' });
  try { const { usage, ...result } = await searchAndAnswer(userId, q); void usage; return res.json(result); }
  catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

/** GET /search/:userId/source/:kind/:id -- one source in full; only ever the person's own. */
searchRouter.get('/:userId/source/:kind/:id', async (req, res) => {
  const kind = req.params.kind as SourceKind;
  if (!['item', 'fact', 'answer', 'saved'].includes(kind)) return res.status(400).json({ error: 'unknown kind' });
  const source = await openSource(req.params.userId, kind, req.params.id);
  return source ? res.json({ source }) : res.status(404).json({ error: 'not found' });
});
