import { config } from '../config';
import type { VoicePersona } from '../types';

const TTS_URL_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

// eleven_v3 hard limit per request
const V3_CHAR_LIMIT = 5000;

export const VOICE_PERSONAS: Record<
  VoicePersona,
  { displayName: string; voiceId: string; stability: number; style: number }
> = {
  thoughtful_friend: {
    displayName: 'Thoughtful Friend',
    voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel — warm, conversational
    stability: 0.3,
    style: 0.4,
  },
  wise_mentor: {
    displayName: 'Wise Mentor',
    voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam — calm, grounded
    stability: 0.5,
    style: 0.2,
  },
  energetic_host: {
    displayName: 'Energetic Host',
    voiceId: 'ErXwobaYiN019PkySvjV', // Antoni — dynamic
    stability: 0.2,
    style: 0.6,
  },
};

export function getPersonaConfig(persona: VoicePersona) {
  return VOICE_PERSONAS[persona];
}

export function estimateDuration(script: string): number {
  const words = script.split(/\s+/).filter(Boolean).length;
  return Math.round((words / 150) * 60);
}

export interface TtsOptions {
  persona?: VoicePersona;
  voiceId?: string;
  modelId?: string;
}

/**
 * Split text into chunks of at most maxChars, breaking only at sentence
 * boundaries (. ! ?) to avoid mid-sentence cuts in the audio.
 */
function chunkScript(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    // Find the last sentence boundary within the limit
    const slice = remaining.slice(0, maxChars);
    const lastBoundary = Math.max(
      slice.lastIndexOf('. '),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('? '),
      slice.lastIndexOf('.\n'),
    );

    const cutAt = lastBoundary > 0 ? lastBoundary + 1 : maxChars;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function ttsChunk(
  text: string,
  voiceId: string,
  modelId: string,
  stability: number,
  style: number,
  apiKey: string,
): Promise<Buffer> {
  const res = await fetch(`${TTS_URL_BASE}/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability,
        similarity_boost: 0.75,
        style,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Convert script to MP3 audio buffer. If no API key is configured,
 * returns an empty buffer (useful in --dry-run / dev).
 * Automatically chunks the script for eleven_v3's 5,000 char limit.
 */
export async function textToSpeech(script: string, options: TtsOptions = {}): Promise<Buffer> {
  if (!config.elevenlabs.apiKey) {
    console.warn('[elevenlabs] ELEVENLABS_API_KEY is not set — skipping TTS');
    return Buffer.alloc(0);
  }

  const modelId = options.modelId ?? config.elevenlabs.modelId;
  const persona = options.persona ?? 'thoughtful_friend';
  const personaConfig = VOICE_PERSONAS[persona];
  const voiceId = options.voiceId ?? (config.elevenlabs.defaultVoiceId || personaConfig.voiceId);

  const isV3 = modelId === 'eleven_v3';
  const charLimit = isV3 ? V3_CHAR_LIMIT : 10000;
  const chunks = chunkScript(script, charLimit);

  console.log(
    `[elevenlabs] Starting TTS: ${script.length} chars, model=${modelId}, chunks=${chunks.length}, key present (${config.elevenlabs.apiKey.slice(0, 8)}...)`
  );

  const buffers = await Promise.all(
    chunks.map((chunk) =>
      ttsChunk(chunk, voiceId, modelId, personaConfig.stability, personaConfig.style, config.elevenlabs.apiKey)
    )
  );

  return Buffer.concat(buffers);
}
