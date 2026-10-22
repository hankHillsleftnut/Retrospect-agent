import { Router } from 'express';
import { runPodcast as runPodcastEngine } from '../pipelines/podcast';
import { checkDailySpend, spendLimitedBody } from '../pipelines/spend-guard';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { audioPathOf, signedAudioUrl, type SignedAudio } from '../services/audio-storage';
import type { DbPodcastEpisode } from '../types';

export interface PodcastsDeps {
  runPodcast: typeof runPodcastEngine;
  /** Signs a link to one audio object (BEA.7); injected so tests never reach storage. */
  signAudio: (path: string | null) => Promise<SignedAudio | null>;
}

export function makePodcastsRouter(deps: Partial<PodcastsDeps> = {}): Router {
  const d: PodcastsDeps = { runPodcast: runPodcastEngine, signAudio: (path) => signedAudioUrl(path), ...deps };
  const router = Router();

  /**
   * POST /podcasts/generate
   * Body: { userId, daysBack?, skipTTS?, dryRun?, persona?, notes? }
   * `audio` is a signed link that expires; `audioUrl` is the public URL old app versions read, until X07.
   */
  router.post('/generate', async (req, res) => {
    const { userId, daysBack, skipTTS, dryRun, persona, notes } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
      // Episodes are the expensive part; a dry run makes no audio and is not limited.
      if (!dryRun) {
        const spend = await checkDailySpend(userId);
        if (!spend.allowed) {
          console.warn(`[podcasts] refused for ${userId}: ${spend.message}`);
          return res.status(429).json(spendLimitedBody(spend));
        }
      }
      const result = await d.runPodcast({
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
        audio: await d.signAudio(result.audioPath),
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

  /** GET /podcasts/:userId -- their episodes, newest first, each with a signed `audio` link when it has audio. */
  router.get('/:userId', async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from(Tables.PODCAST_EPISODES)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    const episodes = await Promise.all(((data ?? []) as DbPodcastEpisode[]).map(async (row) => ({ ...row, audio: await d.signAudio(audioPathOf(row)) })));
    return res.json({ episodes });
  });

  return router;
}

export const podcastsRouter = makePodcastsRouter();
