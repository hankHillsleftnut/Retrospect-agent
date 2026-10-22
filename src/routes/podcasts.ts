import { Router } from 'express';
import { runPodcast as runPodcastEngine } from '../pipelines/podcast';
import { checkDailySpend, spendLimitedBody } from '../pipelines/spend-guard';
import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { audioPathOf, signedAudioUrl, signedAudioUrls, type SignedAudio } from '../services/audio-storage';
import type { DbPodcastEpisode } from '../types';

export interface PodcastsDeps {
  runPodcast: typeof runPodcastEngine;
  /** Signs a link to one audio object (BEA.7); injected so tests never reach storage. */
  signAudio: (path: string | null) => Promise<SignedAudio | null>;
  /** Signs many at once (one storage call for a list), one entry per path, in order. */
  signAudioMany: (paths: Array<string | null>) => Promise<Array<SignedAudio | null>>;
}

/**
 * Mounted behind requireInternalSecret (index.ts): the backend's doors are the only caller, and
 * they pass the signed-in person's id, so `:userId` here is the service's word, not a client's.
 */
export function makePodcastsRouter(deps: Partial<PodcastsDeps> = {}): Router {
  const d: PodcastsDeps = { runPodcast: runPodcastEngine, signAudio: (path) => signedAudioUrl(path), signAudioMany: (paths) => signedAudioUrls(paths), ...deps };
  const router = Router();

  /**
   * POST /podcasts/generate
   * Body: { userId, daysBack?, skipTTS?, dryRun?, persona?, notes? }
   * `audio` is a signed link that expires; `audioUrl` is the public URL old app versions read, until X07.
   * `outcome` is 'made', or (planner v2, BEA.8) 'quiet_week' / 'nothing_safe_to_say': a 200 with no episode,
   * the `plan` and the `guard` numbers, never a 500. `plan` and `guard` replace `outlineV2` for v2 runs.
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
      if (result.outcome !== 'made') {
        return res.json({ outcome: result.outcome, traceId: result.traceId, episodeId: null, plan: result.v2?.plan ?? null, guard: result.v2?.guard ?? null, cost: result.cost });
      }
      return res.json({
        outcome: result.outcome,
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
        plan: result.v2?.plan ?? null,
        guard: result.v2?.guard ?? null,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** GET /podcasts/:userId -- their episodes, newest first, each with a signed `audio` link when it has audio (signed in one call). */
  router.get('/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
      const { data, error } = await supabase
        .from(Tables.PODCAST_EPISODES)
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.code ?? 'db');
      const rows = (data ?? []) as DbPodcastEpisode[];
      const links = await d.signAudioMany(rows.map(audioPathOf));
      return res.json({ episodes: rows.map((row, i) => ({ ...row, audio: links[i] ?? null })) });
    } catch (err) {
      // Never the error's words (they can carry row values): a code in the log, 'internal' to the caller.
      console.error(`[podcasts] list failed: ${err instanceof Error ? err.message.slice(0, 40) : 'unknown'}`);
      return res.status(500).json({ error: 'internal' });
    }
  });

  return router;
}

export const podcastsRouter = makePodcastsRouter();
