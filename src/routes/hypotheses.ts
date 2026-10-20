import { Router } from 'express';
import { supabase } from '../db/supabase';
import { answerHypothesis } from '../hypotheses/offer';
import { FRAMEWORKS, type FrameworkId } from '../hypotheses/validate';

/** Goal 21 for the app: decline in one word, and "why do you think that" always has an answer. */
export const hypothesesRouter = Router();

/** POST /hypotheses/:userId/:id { verdict: "yes" | "no" } */
hypothesesRouter.post('/:userId/:id', async (req, res) => {
  const verdict = req.body?.verdict;
  if (verdict !== 'yes' && verdict !== 'no') return res.status(400).json({ error: 'verdict "yes" or "no"' });
  try { return res.json(await answerHypothesis(req.params.userId, req.params.id, verdict)); }
  catch (err) { return res.status(404).json({ error: err instanceof Error ? err.message : String(err) }); }
});

/** GET /hypotheses/:userId/:id/why: the framework it comes from and what it rests on. */
hypothesesRouter.get('/:userId/:id/why', async (req, res) => {
  const { data, error } = await supabase.from('hypotheses').select('question,framework,rationale,supports,status').eq('id', req.params.id).eq('user_id', req.params.userId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'not found' });
  const h = data as { question: string; framework: string; rationale: string | null; supports: unknown[]; status: string };
  const f = FRAMEWORKS[h.framework as FrameworkId];
  return res.json({ question: h.question, status: h.status, framework: f ? { name: f.name, source: f.cite, wonders: f.wonders } : { name: h.framework }, rationale: h.rationale, restsOn: h.supports });
});
