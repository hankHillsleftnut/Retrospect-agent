import { Router } from 'express';
import { answerHeldPair, heldPairs } from '../people/run-resolution';

/** People matching for the app (W2.6): the few pairs it won't decide on its own. */
export const peopleRouter = Router();

/** GET /people/:userId/held -- "Is the Sam in your writing Sam Ortiz from your contacts?" */
peopleRouter.get('/:userId/held', async (req, res) => {
  try { return res.json({ pairs: await heldPairs(req.params.userId) }); }
  catch (err) { return res.status(500).json({ error: err instanceof Error ? err.message : String(err) }); }
});

/** POST /people/:userId/held/:id { verdict: "same" | "different" } */
peopleRouter.post('/:userId/held/:id', async (req, res) => {
  const v = req.body?.verdict;
  if (v !== 'same' && v !== 'different') return res.status(400).json({ error: 'verdict "same" or "different"' });
  try { return res.json(await answerHeldPair(req.params.userId, req.params.id, v)); }
  catch (err) { return res.status(404).json({ error: err instanceof Error ? err.message : String(err) }); }
});
