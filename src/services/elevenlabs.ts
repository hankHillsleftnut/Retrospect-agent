import { config } from '../config';
import type { VoicePersona } from '../types';

const TTS_URL_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

/**
 * Built-in ElevenLabs voice IDs (matches Retrospect's existing configuration).
 * Override any persona's voice via ELEVENLABS_VOICE_ID env var.
 */
export const VOICE_PERSONAS: Record<
  VoicePersona,
  { displayName: string; voiceId: string; stability: number }
> = {
  thoughtful_friend: {
    displayName: 'Thoughtful Friend',
    voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel — warm, conversational
    stability: 0.0,
  },
  wise_mentor: {
    displayName: 'Wise Mentor',
    voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam — calm, grounded
    stability: 0.5,
  },
  energetic_host: {
    displayName: 'Energetic Host',
    voiceId: 'ErXwobaYiN019PkySvjV', // Antoni — dynamic
    stability: 0.0,
  },
};

export function getPersonaConfig(persona: VoicePersona) {
  return VOICE_PERSONAS[persona];
}

export function estimateDuration(script: string): number {
  // ~150 words/minute average podcast pace
  const words = script.split(/\s+/).filter(Boolean).length;
  return Math.round((words / 150) * 60);
}

export interface TtsOptions {
  persona?: VoicePersona;
  voiceId?: string;
  modelId?: string;
}

/**
 * Convert script to MP3 audio buffer. If no API key is configured,
 * returns an empty buffer (useful in --dry-run / dev).
 */
export async function textToSpeech(script: string, options: TtsOptions = {}): Promise<Buffer> {
  if (!config.elevenlabs.apiKey) {
    return Buffer.alloc(0);
  }

  const persona = options.persona ?? 'thoughtful_friend';
  const personaConfig = VOICE_PERSONAS[persona];
  const voiceId = options.voiceId ?? config.elevenlabs.defaultVoiceId ?? personaConfig.voiceId;

  const res = await fetch(`${TTS_URL_BASE}/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': config.elevenlabs.apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: script,
      model_id: options.modelId ?? config.elevenlabs.modelId,
      voice_settings: { stability: personaConfig.stability, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}
