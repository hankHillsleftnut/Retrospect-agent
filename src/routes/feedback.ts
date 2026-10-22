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
  // Only the episode's owner can leave feedback on it (BEA.2).
  const { data: episode, error: lookupError } = await supabase
    .from(Tables.PODCAST_EPISODES).select('id')
    .eq('id', req.params.episodeId).eq('user_id', userId).maybeSingle();
  if (lookupError) return res.status(500).json({ error: 'feedback lookup failed' });
  if (!episode) return res.status(404).json({ error: 'not found' });
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

/** GET /feedback/episodes/:episodeId?userId=…: that person's feedback on the episode only (BEA.2). */
feedbackRouter.get('/episodes/:episodeId', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const { data, error } = await supabase
    .from(Tables.EPISODE_FEEDBACK)
    .select('*')
    .eq('user_id', userId)
    .eq('episode_id', req.params.episodeId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ feedback: data ?? [] });
});
