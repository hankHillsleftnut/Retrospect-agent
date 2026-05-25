import { Router } from 'express';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export const feedbackRouter = Router();

/**
 * POST /feedback/episodes/:episodeId
 * Body: { userId, text, rating?, source? }
 */
feedbackRouter.post('/episodes/:episodeId', async (req, res) => {
  const { userId, text, rating, source } = req.body ?? {};
  if (!userId || !text) return res.status(400).json({ error: 'userId and text required' });
  const { data, error } = await supabase
    .from(Tables.EPISODE_FEEDBACK)
    .insert({
      user_id: userId,
      episode_id: req.params.episodeId,
      feedback_text: text,
      rating: rating ?? null,
      source: source ?? 'manual',
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ feedback: data });
});

feedbackRouter.get('/episodes/:episodeId', async (req, res) => {
  const { data, error } = await supabase
    .from(Tables.EPISODE_FEEDBACK)
    .select('*')
    .eq('episode_id', req.params.episodeId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ feedback: data ?? [] });
});
