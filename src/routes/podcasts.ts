import { Router } from 'express';
import { runPodcast } from '../pipelines/podcast';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';

export const podcastsRouter = Router();

/**
 * POST /podcasts/generate
 * Body: { userId, daysBack?, skipTTS?, dryRun?, persona?, notes? }
 */
podcastsRouter.post('/generate', async (req, res) => {
  const { userId, daysBack, skipTTS, dryRun, persona, notes } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const result = await runPodcast({
      userId,
      daysBack,
      skipTTS: !!skipTTS,
      dryRun: !!dryRun,
      triggeredBy: 'http',
      persona,
      notes,
    });
    return res.json({
      traceId: result.traceId,
      episodeId: result.episodeId,
      title: result.title,
      description: result.description,
      mood: result.mood,
      durationSeconds: result.durationSeconds,
      audioUrl: result.audioUrl,
      script: result.script,
      summary: result.summary,
      outlineV2: result.outlineV2,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

podcastsRouter.get('/:userId', async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabase
    .from(Tables.PODCAST_EPISODES)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ episodes: data ?? [] });
});
