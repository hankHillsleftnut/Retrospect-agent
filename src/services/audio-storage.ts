/**
 * Episode audio in storage (BEA.7): private objects, signed links.
 *
 * Until now an episode's audio was a public, permanent URL with the person's
 * id in the path. The brain now keeps the object path (podcast_episodes
 * .audio_path) and hands out a signed link that expires; the bucket can then be
 * switched to private (a founder-approved production step, sequenced with
 * X07, when no old app version still plays the public URL).
 *
 * Old app versions read audio_url from the backend's episode rows, so the
 * public URL is still written there until X07, built here without asking
 * storage (it is a fixed string, not a capability).
 */

import { supabase } from '../db/supabase';
import { config } from '../config';

export const AUDIO_BUCKET = 'podcast-audio';
/** How long a signed link lives. One hour: long enough to finish an episode, short enough to matter. */
export const SIGNED_AUDIO_TTL_SECONDS = 3600;
/** The longest link anyone may ask for: a day. */
const MAX_TTL_SECONDS = 24 * 3600;

export type AudioStorage = Pick<ReturnType<typeof supabase.storage.from>, 'upload' | 'createSignedUrl'>;
const defaultStorage = (): AudioStorage => supabase.storage.from(AUDIO_BUCKET);

/** Where an episode's audio lives: under the person, named by its run. */
export function episodeAudioPath(userId: string, runId: string): string {
  return `podcasts/${userId}/${runId}.mp3`;
}

/**
 * The object path inside a public URL of this bucket, or null when the URL is
 * not one. Pure; the backfill in migration 154 applies the same rule in SQL.
 */
export function audioPathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /\/storage\/v1\/object\/public\/podcast-audio\/(.+)$/.exec(url);
  if (!m) return null;
  const path = m[1]!.split('?')[0]!;
  try { return decodeURIComponent(path); } catch { return path; }
}

/** The public URL old app versions read (until X07). Stops working the day the bucket goes private. */
export function legacyPublicAudioUrl(path: string): string {
  return `${config.supabase.url.replace(/\/$/, '')}/storage/v1/object/public/${AUDIO_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Put the audio in the bucket. Returns the path, or null (logged by code) when storage refused it. */
export async function storeEpisodeAudio(path: string, audio: Buffer, storage: AudioStorage = defaultStorage()): Promise<string | null> {
  const { error } = await storage.upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
  if (error) {
    console.warn(`[audio-storage] upload failed: ${error.message}`);
    return null;
  }
  return path;
}

export interface SignedAudio {
  url: string;
  /** When the link stops working (ISO). */
  expiresAt: string;
}

/**
 * A link to one audio object that expires. Null when there is no audio, or
 * when storage could not sign it (logged, never thrown: an episode without a
 * playable link is still an episode).
 */
export async function signedAudioUrl(
  path: string | null | undefined,
  ttlSeconds: number = SIGNED_AUDIO_TTL_SECONDS,
  options: { storage?: AudioStorage; now?: Date } = {},
): Promise<SignedAudio | null> {
  if (!path) return null;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new RangeError(`signed audio ttl must be 1..${MAX_TTL_SECONDS} seconds`);
  }
  const storage = options.storage ?? defaultStorage();
  const now = options.now ?? new Date();
  const { data, error } = await storage.createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    console.warn(`[audio-storage] could not sign a link: ${error?.message ?? 'no url returned'}`);
    return null;
  }
  return { url: data.signedUrl, expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString() };
}

/** The path for an episode row: the stored one, else derived from a public URL written before 154's backfill ran. */
export function audioPathOf(row: { audio_path?: string | null; audio_url?: string | null }): string | null {
  return row.audio_path ?? audioPathFromPublicUrl(row.audio_url);
}
