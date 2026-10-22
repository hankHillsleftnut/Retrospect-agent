import { readAppetite } from '../appetite/appetite';
import { readLearning } from '../learning/reception';
import { proposeHypotheses, storeHypotheses } from '../hypotheses/propose';
import { chooseOffer, loadOfferable, markOffered, readHypothesisDial } from '../hypotheses/offer';
/**
 * The weekly episode from the new brain (W6.4): read contract (W4) -> plan
 * (W5) -> script (W6.2, writer style from W6.3) -> sentence-by-sentence fact
 * check (W6.1) -> the same voice, storage and episode record as before.
 *
 * Behind a per-person switch (plannerV2For in podcast.ts); the old Cook A/B/C
 * path stays as the comparison until the founder's audio check (W7).
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { config } from '../config';
import { chatCompletion } from '../services/openai';
import { generateEmbedding } from '../services/embeddings';
import { textToSpeech, estimateDuration, VOICE_PERSONAS } from '../services/elevenlabs';
import { episodeAudioPath, legacyPublicAudioUrl, storeEpisodeAudio } from '../services/audio-storage';
import { EPISODE_SUMMARY_SYSTEM_PROMPT } from '../prompts/episode-summary';
import { Trace, costLines } from './trace';
import { readUnderstanding } from '../understanding/read';
import { readSaidVsDid } from '../understanding/said-vs-did';
import { readContentGroups, nameGroups } from '../understanding/content-groups';
import { planEpisode } from '../planner/plan';
import { writeEpisode, scriptText, type WriterStyle } from '../writer/write-episode';
import type { PodcastOptions, PodcastResult } from './podcast';
import type { VoicePersona } from '../types';

export async function runPodcastV2(options: PodcastOptions): Promise<PodcastResult> {
  const trace = options.dryRun ? Trace.memoryOnly() : await Trace.start({
    userId: options.userId, kind: 'podcast', triggeredBy: options.triggeredBy ?? 'manual', notes: `planner v2${options.notes ? `: ${options.notes}` : ''}`,
  });
  try {
    const now = new Date();
    const asOf = now.toISOString().slice(0, 10);
    const [contract, svd, cg] = await Promise.all([readUnderstanding(options.userId), readSaidVsDid(options.userId), readContentGroups(options.userId)]);
    const named = await nameGroups(cg.groups);
    trace.addCost({ anthropic_tokens_input: svd.usage.inputTokens + named.usage.inputTokens, anthropic_tokens_output: svd.usage.outputTokens + named.usage.outputTokens }, config.anthropic.timeCategoryModel);

    // Goal 22: how boldly to speak, only when the founder's switch is on (ENABLE_APPETITE).
    const appetite = process.env.ENABLE_APPETITE === 'true' ? (await readAppetite(options.userId)).level : undefined;
    // Goal 19: its own track record nudges ordering (bounded 0.8-1.2), only with ENABLE_LEARNING on.
    const learning = process.env.ENABLE_LEARNING === 'true' ? (await readLearning(options.userId)).current?.arms : undefined;
    // Goal 21: hypotheses are proposed and stored every week (code decides what may exist);
    // one is offered only when the founder's dial says speak and appetite is high enough.
    const dial = await readHypothesisDial();
    let offer = null;
    try {
      if (!options.dryRun) {
        const proposed = await proposeHypotheses(contract);
        trace.addCost({ anthropic_tokens_input: proposed.usage.inputTokens, anthropic_tokens_output: proposed.usage.outputTokens }, config.anthropic.writerModel);
        await storeHypotheses(options.userId, proposed.valid);
      }
      if (dial.speak) offer = chooseOffer(await loadOfferable(options.userId), contract, appetite ?? (await readAppetite(options.userId)).level, dial, now);
    } catch (err) {
      console.warn(`[podcast-v2] hypotheses skipped: ${(err as Error).message}`);
    }
    const plan = planEpisode(contract, { saidVsDid: svd.goals, content: named.groups, learning }, 6, appetite, offer);
    if (plan.items.length === 0) throw new Error('Nothing this week clears the bar to be said: a quiet week (planner v2 never pads).');

    const style = (process.env.EPISODE_WRITER_STYLE as WriterStyle | undefined) ?? 'heavy';
    const { data: userRow } = await supabase.from(Tables.USERS).select('voice_persona').eq('id', options.userId).maybeSingle();
    const { data: prefs } = await supabase.from(Tables.USER_PREFERENCES).select('tone').eq('user_id', options.userId).maybeSingle();
    const episode = await writeEpisode(plan, { asOf, style, listener: { tone: (prefs as { tone?: string } | null)?.tone ?? null } });
    trace.addCost({ anthropic_tokens_input: episode.usage.writer.inputTokens, anthropic_tokens_output: episode.usage.writer.outputTokens }, config.anthropic.writerModel);
    trace.addCost({ anthropic_tokens_input: episode.usage.guard.inputTokens, anthropic_tokens_output: episode.usage.guard.outputTokens }, config.anthropic.guardModel);

    const script = scriptText(episode);
    if (!script.trim()) throw new Error('The fact check cut every sentence; nothing safe to say.');
    trace.setFinalScript(script);

    const summaryRes = await chatCompletion(EPISODE_SUMMARY_SYSTEM_PROMPT, `Theme: ${episode.title}\n\nScript:\n${script}`, { temperature: 0.4, maxTokens: 600 });
    trace.addCost({ openai_tokens_input: summaryRes.usage.promptTokens, openai_tokens_output: summaryRes.usage.completionTokens }, config.openai.chatModel);
    const summary = summaryRes.text.trim();
    trace.setEpisodeSummary(summary);

    let persona: VoicePersona = options.persona ?? 'thoughtful_friend';
    const vp = (userRow as { voice_persona?: string } | null)?.voice_persona;
    if (!options.persona && vp && vp in VOICE_PERSONAS) persona = vp as VoicePersona;

    // The object path is what is kept; the public URL only for app versions before X07 (BEA.7).
    let audioPath: string | null = null;
    if (!options.skipTTS && !options.dryRun) {
      const audio = await textToSpeech(script, { persona });
      if (audio.length > 0) {
        trace.addCost({ elevenlabs_chars: script.length });
        audioPath = await storeEpisodeAudio(episodeAudioPath(options.userId, trace.id ?? String(Date.now())), audio);
      }
    }
    const audioUrl = audioPath ? legacyPublicAudioUrl(audioPath) : null;
    trace.setAudioUrl(audioUrl);

    const durationSeconds = estimateDuration(script);
    let episodeId: string | null = null;
    if (!options.dryRun) {
      const { count } = await supabase.from(Tables.PODCAST_EPISODES).select('*', { count: 'exact', head: true }).eq('user_id', options.userId).eq('status', 'ready');
      const { data: row, error } = await supabase.from(Tables.PODCAST_EPISODES).insert({
        user_id: options.userId, title: episode.title, description: summary.split('\n')[0]!.slice(0, 280), script,
        audio_path: audioPath, audio_url: audioUrl, duration_seconds: durationSeconds, mood: 'reflective', generation_type: 'weekly', status: 'ready',
        episode_number: (count ?? 0) + 1, covers_period_start: new Date(now.getTime() - 28 * 864e5).toISOString(), covers_period_end: now.toISOString(),
        outline: { planner: 'v2', style, plan } as unknown as Record<string, unknown>,
        topics_covered: plan.items.map((i) => i.kind), summary, summary_embedding: await generateEmbedding(summary),
        metadata: { planner: 'v2', writer_style: style, voice_persona: persona, word_count: script.split(/\s+/).length, guard: episode.stats, withheld: plan.withheld.length },
      }).select('id').single();
      if (error) throw new Error(`Insert podcast episode failed: ${error.message}`);
      episodeId = (row as { id: string }).id;
      // Counted only if the offer survived the fact check into the script.
      if (plan.hypothesis && episode.sections.some((s) => s.id === `hypothesis:${plan.hypothesis!.id}` && s.kept.length)) await markOffered(options.userId, plan.hypothesis.id);
      trace.setEpisodeId(episodeId);
    }
    await trace.complete();
    return {
      traceId: trace.id, episodeId, script, audioPath, audioUrl, summary, title: episode.title, description: summary.split('\n')[0] ?? '',
      mood: 'reflective', durationSeconds, cost: costLines(trace.snapshot().cost_breakdown),
      v2: { plan, guard: { sentences: episode.stats.sentences, kept: episode.stats.kept, cut: episode.stats.cut } },
    };
  } catch (err) {
    await trace.fail(err);
    throw err;
  }
}
