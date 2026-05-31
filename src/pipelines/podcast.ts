import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { chatCompletion, jsonChatCompletion } from '../services/openai';
import { generateEmbedding } from '../services/embeddings';
import { textToSpeech, estimateDuration, VOICE_PERSONAS } from '../services/elevenlabs';
import { CURRENT_CONTEXT_OUTLINE_SYSTEM_PROMPT } from '../prompts/current-context-outline';
import { FINAL_TRANSCRIPT_SYSTEM_PROMPT, PERSONA_PROMPT_STYLES } from '../prompts/final-transcript';
import {
  EPISODE_SUMMARY_SYSTEM_PROMPT,
  EPISODE_TITLE_DESC_SYSTEM_PROMPT,
} from '../prompts/episode-summary';
import { runPodcastAgent } from '../agents/podcast-agent';
import { Trace, TraceTrigger } from './trace';
import type {
  DbGoal,
  DbInsight,
  DbObservation,
  DbPodcastEpisode,
  DbRawContent,
  DbUser,
  DbUserPreferences,
  DbUserUnderstanding,
  DbEpisodeFeedback,
  OutlineV1,
  OutlineV2,
  UserUnderstandingDocument,
  VoicePersona,
} from '../types';

export interface PodcastOptions {
  userId: string;
  daysBack?: number;
  skipTTS?: boolean;
  dryRun?: boolean;
  triggeredBy?: TraceTrigger;
  persona?: VoicePersona;
  notes?: string;
  /**
   * If provided, skip Pass A and use this outline.
   * If outlineV2 is also provided, also skip Pass B.
   */
  outlineV1?: OutlineV1;
  outlineV2?: OutlineV2;
  parentRunId?: string | null;
}

export interface PodcastResult {
  traceId: string | null;
  episodeId: string | null;
  outlineV1: OutlineV1;
  outlineV2: OutlineV2;
  script: string;
  audioUrl: string | null;
  summary: string;
  title: string;
  description: string;
  mood: string;
  durationSeconds: number;
}

// ============================================
// Cook A — Current-Context Outline
// ============================================
async function cookA(input: {
  goals: DbGoal[];
  insights: DbInsight[];
  observations: DbObservation[];
  onboardingProfile: DbRawContent | null;
  userUnderstanding: UserUnderstandingDocument | null;
  voicePersona: VoicePersona | null;
  trace: Trace;
}): Promise<OutlineV1> {
  const goalLines = input.goals.map(
    (g) => `- [${g.id}] "${g.title}"${g.description ? `: ${g.description}` : ''}`
  );
  const insightLines = input.insights.map(
    (i) => `- [${i.id}] (${i.created_at.slice(0, 10)}) "${i.title}": ${i.content}\n    Evidence: ${i.evidence_summary}\n    Goal: ${i.goal_id}`
  );
  const observationLines = input.observations.slice(0, 60).map(
    (o) => `- [${o.id}] (goal: ${o.goal_id ?? 'unassigned'}, ${o.observation_date.slice(0, 10)}) ${o.content}`
  );

  const foundationBlock = formatOnboardingFoundation(
    input.onboardingProfile,
    input.voicePersona
  );

  const understandingBlock = formatUserUnderstanding(input.userUnderstanding);

  const userMessage = `${understandingBlock}

${foundationBlock}

# Active Goals
${goalLines.join('\n') || '(none)'}

# Recent Insights (last 2 weeks)
${insightLines.join('\n') || '(none)'}

# Recent Observations (last 2 weeks)
${observationLines.join('\n') || '(none)'}

Produce the structured OutlineV1 JSON. Use the User Understanding Document as the model of who this person is; use the recent insights and observations to decide what's alive right now and worth surfacing this week.`;

  const { data, usage } = await jsonChatCompletion<OutlineV1>(
    CURRENT_CONTEXT_OUTLINE_SYSTEM_PROMPT,
    userMessage,
    { temperature: 0.4, maxTokens: 4096 }
  );
  input.trace.addCost({
    openai_tokens_input: usage.promptTokens,
    openai_tokens_output: usage.completionTokens,
  });
  input.trace.setOutlineV1(data);
  return data;
}

// ============================================
// Cook C — Final Transcript
// ============================================
async function cookC(input: {
  outline: OutlineV2;
  preferences: DbUserPreferences | null;
  unprocessedFeedback: { date: string; text: string }[];
  onboardingProfile: DbRawContent | null;
  voicePersona: VoicePersona | null;
  trace: Trace;
}): Promise<string> {
  const prefsBlock = input.preferences
    ? `tone: ${input.preferences.tone ?? '(none)'}
trusted_voice_description: ${input.preferences.trusted_voice_description ?? '(none)'}
focus_areas: ${input.preferences.focus_areas.join(', ') || '(none)'}
avoid_topics: ${input.preferences.avoid_topics.join(', ') || '(none)'}
recent directives:
${input.preferences.directives.slice(-10).reverse().map((d) => `  - (${d.date.slice(0, 10)}) ${d.text}`).join('\n') || '  (none)'}`
    : '(no preferences set)';

  const feedbackBlock = input.unprocessedFeedback.length > 0
    ? `\n\n# Unprocessed Feedback\n${input.unprocessedFeedback.map((f) => `  - (${f.date.slice(0, 10)}) ${f.text}`).join('\n')}`
    : '';

  const foundationBlock = formatOnboardingFoundation(
    input.onboardingProfile,
    input.voicePersona
  );

  const personaStyle = PERSONA_PROMPT_STYLES[input.voicePersona ?? 'thoughtful_friend']
    ?? PERSONA_PROMPT_STYLES['thoughtful_friend'];

  const userMessage = `${foundationBlock}

# User Preferences
${prefsBlock}${feedbackBlock}

# Voice Persona Style
${personaStyle}

# Enriched Outline (from Cook B)
${JSON.stringify(input.outline, null, 2)}

Write the final podcast script now. Honor the notRealizedYet hints — set up the pieces, don't name the realization.`;

  const { text, usage } = await chatCompletion(FINAL_TRANSCRIPT_SYSTEM_PROMPT, userMessage, {
    temperature: 0.7,
    maxTokens: 6000,
  });
  input.trace.addCost({
    openai_tokens_input: usage.promptTokens,
    openai_tokens_output: usage.completionTokens,
  });
  input.trace.setFinalScript(text);
  return text;
}

// ============================================
// Helpers
// ============================================
async function loadContext(userId: string, daysBack: number) {
  const sinceIso = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const [
    userRes,
    goalsRes,
    insightsRes,
    observationsRes,
    prefsRes,
    feedbackRes,
    lastEpisodeRes,
    onboardingRes,
    understandingRes,
  ] = await Promise.all([
    supabase.from(Tables.USERS).select('*').eq('id', userId).maybeSingle(),
    supabase.from(Tables.GOALS).select('*').eq('user_id', userId).eq('is_active', true),
    supabase
      .from(Tables.INSIGHTS)
      .select('*')
      .eq('user_id', userId)
      .gte('updated_at', sinceIso)
      .order('updated_at', { ascending: false }),
    supabase
      .from(Tables.OBSERVATIONS)
      .select('*')
      .eq('user_id', userId)
      .gte('observation_date', sinceIso)
      .order('observation_date', { ascending: false }),
    supabase.from(Tables.USER_PREFERENCES).select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from(Tables.EPISODE_FEEDBACK)
      .select('*')
      .eq('user_id', userId)
      .eq('processed', false)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from(Tables.PODCAST_EPISODES)
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from(Tables.RAW_CONTENT)
      .select('*')
      .eq('user_id', userId)
      .eq('content_type', 'onboarding_profile')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from(Tables.USER_UNDERSTANDING)
      .select('*')
      .eq('user_id', userId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const understanding = (understandingRes.data ?? null) as DbUserUnderstanding | null;

  return {
    user: (userRes.data ?? null) as DbUser | null,
    goals: (goalsRes.data ?? []) as DbGoal[],
    insights: (insightsRes.data ?? []) as DbInsight[],
    observations: (observationsRes.data ?? []) as DbObservation[],
    preferences: (prefsRes.data ?? null) as DbUserPreferences | null,
    unprocessedFeedback: ((feedbackRes.data ?? []) as DbEpisodeFeedback[]).map((f) => ({
      date: f.created_at,
      text: f.feedback_text,
      id: f.id,
    })),
    lastEpisode: (lastEpisodeRes.data ?? null) as DbPodcastEpisode | null,
    onboardingProfile: (onboardingRes.data ?? null) as DbRawContent | null,
    userUnderstanding: understanding,
    userUnderstandingDocument: (understanding?.document ?? null) as UserUnderstandingDocument | null,
  };
}

function formatUserUnderstanding(doc: UserUnderstandingDocument | null): string {
  if (!doc) {
    return `# USER UNDERSTANDING DOCUMENT
(none yet — Cook 0 has not produced a document for this user. Fall back to deriving identity from observations + onboarding.)`;
  }

  const goalsBlock = doc.active_goals
    .map((g) => `  - "${g.title}" — ${g.what_its_really_about}`)
    .join('\n');
  const tensionsBlock = doc.live_tensions.map((t) => `  - ${t}`).join('\n');
  const emergingBlock = doc.emerging_dimensions
    .map((d) => `  - [${d.label}] ${d.content}`)
    .join('\n');

  return `# USER UNDERSTANDING DOCUMENT
This is the agent's compressed, current model of who this user is. Use it as the LENS for what matters; do not re-derive who they are from observations. Recent insights and observations tell you what is alive RIGHT NOW — this document tells you who is experiencing it.

## Identity Core
${doc.identity_core || '(empty)'}

## Active Goals
${goalsBlock || '  (none)'}

## Behavioral Patterns
${doc.behavioral_patterns || '(empty)'}

## Emotional Baseline
${doc.emotional_baseline || '(empty)'}

## Live Tensions
${tensionsBlock || '  (none)'}

## Track Record
${doc.track_record || '(empty)'}

## Forward Focus
${doc.forward_focus || '(empty)'}

## Emerging Dimensions
${emergingBlock || '  (none)'}`;
}

function formatOnboardingFoundation(
  onboardingProfile: DbRawContent | null,
  voicePersona: VoicePersona | null
): string {
  if (!onboardingProfile) {
    return `# Foundational Onboarding Profile
(none yet)`;
  }

  const metadata = onboardingProfile.metadata
    ? `\nmetadata: ${JSON.stringify(onboardingProfile.metadata).slice(0, 1200)}`
    : '';

  return `# Foundational Onboarding Profile
This is the user's first self-description inside Retrospect. Treat it as the foundation for interpreting what matters to them, what they are trying to become, what they are afraid of, and what would make the product feel personally intelligent.
Do not merely recap it. Use it to decide what evidence feels meaningful, what tone will land, and which patterns should become part of the person's first impression of Retrospect.
voice_persona: ${voicePersona ?? '(not set)'}
raw_content_id: ${onboardingProfile.id}
created_at: ${onboardingProfile.created_at}${metadata}

${onboardingProfile.content.slice(0, 8000)}`;
}

// ============================================
// Main pipeline
// ============================================
export async function runPodcast(options: PodcastOptions): Promise<PodcastResult> {
  const daysBack = options.daysBack ?? 14;
  const trace = options.dryRun
    ? Trace.memoryOnly()
    : await Trace.start({
        userId: options.userId,
        kind: 'podcast',
        triggeredBy: options.triggeredBy ?? 'manual',
        parentRunId: options.parentRunId ?? null,
        notes: options.notes,
      });

  try {
    const ctx = await loadContext(options.userId, daysBack);

    if (!options.dryRun && trace.id) {
      await supabase
        .from(Tables.PIPELINE_RUN_TRACES)
        .update({
          inputs_snapshot: {
            daysBack,
            active_goal_ids: ctx.goals.map((g) => g.id),
            insight_ids: ctx.insights.map((i) => i.id),
            observation_ids: ctx.observations.map((o) => o.id),
            unprocessed_feedback_ids: ctx.unprocessedFeedback.map((f) => f.id),
            preferences_present: !!ctx.preferences,
            last_episode_id: ctx.lastEpisode?.id ?? null,
            onboarding_profile_id: ctx.onboardingProfile?.id ?? null,
            user_understanding_version: ctx.userUnderstanding?.version ?? null,
            persona: options.persona ?? ctx.user?.voice_persona ?? null,
            skipTTS: !!options.skipTTS,
          },
        })
        .eq('id', trace.id);
    }

    if (
      ctx.insights.length === 0 &&
      ctx.observations.length === 0 &&
      !ctx.onboardingProfile &&
      !ctx.userUnderstandingDocument &&
      !options.outlineV1
    ) {
      throw new Error(
        'Not enough data to generate a podcast episode. Add onboarding context, run ingestion, or seed demo data first.'
      );
    }

    // PASS A — Cook A
    const outlineV1 =
      options.outlineV1 ??
      (await cookA({
        goals: ctx.goals,
        insights: ctx.insights,
        observations: ctx.observations,
        onboardingProfile: ctx.onboardingProfile,
        userUnderstanding: ctx.userUnderstandingDocument,
        voicePersona: ctx.user?.voice_persona ?? null,
        trace,
      }));
    trace.setOutlineV1(outlineV1);

    // PASS B — Cook B (agent)
    const outlineV2 =
      options.outlineV2 ??
      (await runPodcastAgent({
        userId: options.userId,
        outlineV1,
        preferences: ctx.preferences,
        unprocessedFeedback: ctx.unprocessedFeedback.map(({ date, text }) => ({ date, text })),
        onboardingProfile: ctx.onboardingProfile,
        voicePersona: ctx.user?.voice_persona ?? null,
        trace,
      }));
    trace.setOutlineV2(outlineV2);

    // PASS C — Cook C
    const script = await cookC({
      outline: outlineV2,
      preferences: ctx.preferences,
      unprocessedFeedback: ctx.unprocessedFeedback.map(({ date, text }) => ({ date, text })),
      onboardingProfile: ctx.onboardingProfile,
      voicePersona: ctx.user?.voice_persona ?? null,
      trace,
    });

    // Title / description / mood
    const titleDescRes = await jsonChatCompletion<{ title: string; description: string; mood: string }>(
      EPISODE_TITLE_DESC_SYSTEM_PROMPT,
      `Theme: "${outlineV2.theme}"\n\nScript preview:\n${script.slice(0, 600)}`,
      { temperature: 0.6, maxTokens: 256 }
    );
    trace.addCost({
      openai_tokens_input: titleDescRes.usage.promptTokens,
      openai_tokens_output: titleDescRes.usage.completionTokens,
    });
    const titleDesc = titleDescRes.data;

    // Summary (will be embedded and saved)
    const summaryRes = await chatCompletion(
      EPISODE_SUMMARY_SYSTEM_PROMPT,
      `Theme: ${outlineV2.theme}\n\nScript:\n${script}`,
      { temperature: 0.4, maxTokens: 600 }
    );
    trace.addCost({
      openai_tokens_input: summaryRes.usage.promptTokens,
      openai_tokens_output: summaryRes.usage.completionTokens,
    });
    const summary = summaryRes.text.trim();
    trace.setEpisodeSummary(summary);

    // Pick persona
    let persona: VoicePersona = options.persona ?? 'thoughtful_friend';
    if (!options.persona && ctx.user?.voice_persona && ctx.user.voice_persona in VOICE_PERSONAS) {
      persona = ctx.user.voice_persona as VoicePersona;
    }

    // TTS
    let audioUrl: string | null = null;
    let durationSeconds = estimateDuration(script);
    if (!options.skipTTS && !options.dryRun) {
      const audioBuf = await textToSpeech(script, { persona });
      if (audioBuf.length === 0) {
        console.warn('[podcast] TTS returned empty buffer — audio_url will be null');
      } else {
        trace.addCost({ elevenlabs_chars: script.length });
      }
      if (audioBuf.length > 0) {
        const episodeIdPlaceholder = trace.id ?? Date.now().toString();
        const audioPath = `podcasts/${options.userId}/${episodeIdPlaceholder}.mp3`;
        const { error: uploadErr } = await supabase.storage
          .from('podcast-audio')
          .upload(audioPath, audioBuf, { contentType: 'audio/mpeg', upsert: true });
        if (uploadErr) {
          console.warn(`[podcast] Audio upload failed: ${uploadErr.message}`);
        } else {
          const { data: pub } = supabase.storage.from('podcast-audio').getPublicUrl(audioPath);
          audioUrl = pub.publicUrl;
        }
      }
    }
    trace.setAudioUrl(audioUrl);

    // Persist episode (unless dry-run)
    let episodeId: string | null = null;
    if (!options.dryRun) {
      const summaryEmbedding = await generateEmbedding(summary);

      const { count: episodeCount } = await supabase
        .from(Tables.PODCAST_EPISODES)
        .select('*', { count: 'exact', head: true })
        .eq('user_id', options.userId)
        .eq('status', 'ready');
      const episodeNumber = (episodeCount ?? 0) + 1;

      const { data: episode, error: epErr } = await supabase
        .from(Tables.PODCAST_EPISODES)
        .insert({
          user_id: options.userId,
          title: titleDesc.title,
          description: titleDesc.description,
          script,
          audio_url: audioUrl,
          duration_seconds: durationSeconds,
          mood: titleDesc.mood,
          generation_type: 'weekly',
          status: 'ready',
          insight_ids: outlineV2.segments.flatMap((s) => s.insightIds ?? []),
          goal_ids: ctx.goals.map((g) => g.id),
          outline: outlineV2 as unknown as Record<string, unknown>,
          research_citations: outlineV2.researchFindings.flatMap((r) => r.citations),
          episode_number: episodeNumber,
          covers_period_start: new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString(),
          covers_period_end: new Date().toISOString(),
          previous_episode_id: ctx.lastEpisode?.id ?? null,
          topics_covered: outlineV2.segments.map((s) => s.title),
          summary,
          summary_embedding: summaryEmbedding,
          metadata: {
            word_count: script.split(/\s+/).length,
            voice_persona: persona,
            onboarding_profile_id: ctx.onboardingProfile?.id ?? null,
            tool_call_count: trace.snapshot().agent_tool_calls.length,
          },
        })
        .select()
        .single();

      if (epErr) throw new Error(`Insert podcast episode failed: ${epErr.message}`);
      episodeId = episode!.id;
      trace.setEpisodeId(episodeId!);

      // Mark feedback as processed
      const feedbackIds = ctx.unprocessedFeedback.map((f) => f.id);
      if (feedbackIds.length > 0) {
        await supabase
          .from(Tables.EPISODE_FEEDBACK)
          .update({ processed: true })
          .in('id', feedbackIds);

        // Append the feedback as directives to user_preferences
        const directives = ctx.unprocessedFeedback.map((f) => ({
          date: f.date,
          text: f.text,
          source: 'feedback' as const,
        }));
        if (ctx.preferences) {
          await supabase
            .from(Tables.USER_PREFERENCES)
            .update({
              directives: [...(ctx.preferences.directives ?? []), ...directives],
            })
            .eq('id', ctx.preferences.id);
        } else {
          await supabase.from(Tables.USER_PREFERENCES).insert({
            user_id: options.userId,
            directives,
          });
        }
      }
    }

    await trace.complete();

    return {
      traceId: trace.id,
      episodeId,
      outlineV1,
      outlineV2,
      script,
      audioUrl,
      summary,
      title: titleDesc.title,
      description: titleDesc.description,
      mood: titleDesc.mood,
      durationSeconds,
    };
  } catch (err) {
    await trace.fail(err);
    throw err;
  }
}
