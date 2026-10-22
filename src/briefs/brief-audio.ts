/**
 * Brief audio (BE1.3b): briefs are audio (founder, 21 Oct).
 *
 * After a non-quiet brief is saved, each part is spoken on its own with the
 * person's voice persona, measured from the MP3 it came back as (never
 * estimated), and the parts are joined in order. The row then holds the object
 * path in the private `brief-audio` bucket, the measured length, and
 * `audio_parts`: exactly what was spoken with where each part starts, so the
 * door's parts are these and are never split a second time (pass §1.4, F7).
 *
 * `audio_status` is `ready` only after the upload has returned; anything that
 * fails on the way leaves `failed` and a brief that still reads as text.
 */

import { supabase } from '../db/supabase';
import { Tables } from '../db/tables';
import { textToSpeech, VOICE_PERSONAS } from '../services/elevenlabs';
import { costLines } from '../pipelines/trace';
import { recordSpend } from '../pipelines/spend-ledger';
import type { VoicePersona } from '../types';

export const BRIEF_AUDIO_BUCKET = 'brief-audio';
/** Where one brief's audio lives, under the person, named by the synthesis that made it (its claim stamp). */
export const briefAudioPath = (userId: string, briefId: string, stamp: string) => `${userId}/${briefId}-${stamp.replace(/[^0-9]/g, '')}.mp3`;

export type BriefAudioStatus = 'none' | 'making' | 'ready' | 'failed';
export interface AudioPart { index: number; startSeconds: number; text: string }

export interface BriefRowForAudio {
  id: string;
  user_id: string;
  kind: 'brief' | 'quiet';
  through_line: string;
  spine_movement: string | null;
  /** v1 items carry text, why, quote and a source ref; only text is spoken. */
  items: Array<{ text?: unknown }> | null;
  audio_status: BriefAudioStatus;
}

/**
 * The spoken parts of a brief, the one rule both sides share (contract 02 §3):
 * v1 rows speak one part per item; v2 rows (`spine_movement = 'planner v2'`)
 * speak `through_line` split at blank lines; a quiet brief speaks nothing.
 */
export function briefPartsOf(row: Pick<BriefRowForAudio, 'kind' | 'through_line' | 'spine_movement' | 'items'>): string[] {
  if (row.kind === 'quiet') return [];
  const texts = row.spine_movement === 'planner v2'
    ? row.through_line.split(/\n\s*\n/)
    : (row.items ?? []).map((i) => (typeof i.text === 'string' ? i.text : ''));
  return texts.map((t) => t.trim()).filter(Boolean);
}

// ── MP3 frames ───────────────────────────────────────────────────────────────

const BITRATES_KBPS = {
  mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
} as const;
const SAMPLE_RATES = { mpeg1: [44100, 48000, 32000], mpeg2: [22050, 24000, 16000], mpeg25: [11025, 12000, 8000] } as const;

/** The byte length of the Layer III frame starting at `at`, or null when no frame header is there. */
function frameLengthAt(buf: Buffer, at: number): number | null {
  if (at + 4 > buf.length) return null;
  const h = buf.readUInt32BE(at);
  // `&` yields a signed int: compare unsigned, or a sync word never matches.
  if (((h & 0xffe00000) >>> 0) !== 0xffe00000) return null;
  const version = (h >>> 19) & 3;   // 0: MPEG 2.5, 2: MPEG 2, 3: MPEG 1
  const layer = (h >>> 17) & 3;     // 1: Layer III
  const bitrateIndex = (h >>> 12) & 15;
  const rateIndex = (h >>> 10) & 3;
  const padding = (h >>> 9) & 1;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const mpeg1 = version === 3;
  const bitrate = (mpeg1 ? BITRATES_KBPS.mpeg1 : BITRATES_KBPS.mpeg2)[bitrateIndex]! * 1000;
  const sampleRate = (mpeg1 ? SAMPLE_RATES.mpeg1 : version === 2 ? SAMPLE_RATES.mpeg2 : SAMPLE_RATES.mpeg25)[rateIndex]!;
  return Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding;
}

/**
 * The frames alone: a leading ID3v2 tag and a Xing/Info/VBRI header frame are
 * dropped. Joined parts must carry none of those, or a player reads the first
 * part's frame count as the whole file's length and stops early.
 */
export function stripFrameMetadata(mp3: Buffer): Buffer {
  let at = 0;
  if (mp3.length >= 10 && mp3.toString('latin1', 0, 3) === 'ID3') {
    const size = ((mp3[6]! & 0x7f) << 21) | ((mp3[7]! & 0x7f) << 14) | ((mp3[8]! & 0x7f) << 7) | (mp3[9]! & 0x7f);
    at = 10 + size;
  }
  const first = frameLengthAt(mp3, at);
  if (first) {
    const frame = mp3.toString('latin1', at, at + first);
    if (frame.includes('Xing') || frame.includes('Info') || frame.includes('VBRI')) at += first;
  }
  return at === 0 ? mp3 : mp3.subarray(at);
}

/** The length of an MP3, in seconds, read from its frames (music-metadata). */
export async function measureSeconds(mp3: Buffer): Promise<number> {
  // ESM-only, in a CommonJS build: loaded when first needed, as PGlite is in the tests.
  const { parseBuffer } = await import('music-metadata');
  const { format } = await parseBuffer(mp3, { mimeType: 'audio/mpeg' }, { duration: true });
  if (typeof format.duration !== 'number' || !Number.isFinite(format.duration) || format.duration <= 0) {
    throw new Error('the audio has no measurable length');
  }
  return format.duration;
}

// ── Making the audio ─────────────────────────────────────────────────────────

export interface BriefAudioStorage {
  upload(path: string, body: Buffer, options: { contentType: string; upsert: boolean }): Promise<{ error: { message: string } | null }>;
}

export interface BriefAudioDeps {
  db?: typeof supabase;
  /** The voice: text in, MP3 out. ElevenLabs by default; an empty buffer means no voice is configured. */
  tts?: (text: string, persona: VoicePersona) => Promise<Buffer>;
  storage?: BriefAudioStorage;
  measure?: (mp3: Buffer) => Promise<number>;
  now?: () => Date;
  recordSpend?: typeof recordSpend;
}

export type BriefAudioOutcome =
  | { outcome: 'ready'; path: string; durationSeconds: number; parts: AudioPart[]; chars: number }
  | { outcome: 'already_ready' }
  /** Another run holds the claim (started within the last MAKING_STALE_MS). */
  | { outcome: 'already_making' }
  /** The brief was re-made while this synthesis ran; its words are no longer the brief's. */
  | { outcome: 'superseded' }
  | { outcome: 'quiet' }
  | { outcome: 'not_found' }
  | { outcome: 'failed'; reason: 'no_voice' | 'synthesis' | 'upload' | 'billing' | 'save' | 'exception' };

/** A `making` claim older than this belongs to a run that died; the next run may take it over. */
export const MAKING_STALE_MS = 15 * 60 * 1000;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Make (or re-make) one brief's audio. Idempotent: a brief already `ready`
 * comes back as is. Never throws: a failure is `failed`, the row says so, and
 * the brief stays readable as text.
 */
export async function makeBriefAudio(userId: string, briefId: string, deps: BriefAudioDeps = {}): Promise<BriefAudioOutcome> {
  const db = deps.db ?? supabase;
  const tts = deps.tts ?? ((text, persona) => textToSpeech(text, { persona }));
  const storage = deps.storage ?? db.storage.from(BRIEF_AUDIO_BUCKET);
  const measure = deps.measure ?? measureSeconds;
  const now = deps.now ?? (() => new Date());
  const record = deps.recordSpend ?? recordSpend;

  const { data: row } = await db.from(Tables.DAILY_BRIEFS)
    .select('id,user_id,kind,through_line,spine_movement,items,audio_status')
    .eq('id', briefId).eq('user_id', userId).maybeSingle();
  if (!row) return { outcome: 'not_found' };
  const brief = row as BriefRowForAudio;
  if (brief.kind === 'quiet') return { outcome: 'quiet' };
  if (brief.audio_status === 'ready') return { outcome: 'already_ready' };
  const texts = briefPartsOf(brief);
  if (!texts.length) return { outcome: 'quiet' };

  // Claim the row atomically before anything is paid for: one synthesis at a time per brief
  // (review, #138: two calls that both read "not ready" would both speak and both pay). The
  // claim stamp is this synthesis's revision: only the synthesis holding it may mark ready.
  const stamp = now().toISOString();
  const claiming = { audio_status: 'making', audio_path: null, audio_parts: [], audio_duration_seconds: null, audio_updated_at: stamp };
  const { data: fresh } = await db.from(Tables.DAILY_BRIEFS).update(claiming)
    .eq('id', briefId).eq('user_id', userId).in('audio_status', ['none', 'failed']).select('id');
  if (!(fresh as unknown[] | null)?.length) {
    // Already being made; a claim older than the grace is a crashed run and may be taken over.
    const stale = new Date(now().getTime() - MAKING_STALE_MS).toISOString();
    const { data: taken } = await db.from(Tables.DAILY_BRIEFS).update(claiming)
      .eq('id', briefId).eq('user_id', userId).eq('audio_status', 'making').lt('audio_updated_at', stale).select('id');
    if (!(taken as unknown[] | null)?.length) return { outcome: 'already_making' };
  }

  const { data: user } = await db.from(Tables.USERS).select('voice_persona').eq('id', userId).maybeSingle();
  const vp = (user as { voice_persona?: string | null } | null)?.voice_persona;
  const persona: VoicePersona = vp && vp in VOICE_PERSONAS ? (vp as VoicePersona) : 'thoughtful_friend';

  // ElevenLabs bills every part it spoke, whether or not the brief gets its audio: charged on every
  // exit, each character once (review, #138). A charge that didn't land is reported, never thrown.
  let chars = 0;
  let charged = 0;
  const charge = async (): Promise<boolean> => {
    const due = chars - charged;
    if (due === 0) return true;
    const lines = costLines({
      openai_tokens_input: 0, openai_tokens_output: 0, anthropic_tokens_input: 0, anthropic_tokens_output: 0,
      embedding_tokens: 0, perplexity_calls: 0, elevenlabs_chars: due, est_usd: 0,
    });
    const expected = lines.reduce((sum, l) => sum + l.usd, 0);
    try {
      const got = await record(userId, 'brief_audio', lines, { db, now: now() });
      if (got + 1e-9 < expected) throw new Error('ledger wrote less than the voice cost');
      charged = chars;
      return true;
    } catch {
      console.error(`[brief-audio] spend not recorded chars=${due}`);
      return false;
    }
  };
  const fail = async (reason: Extract<BriefAudioOutcome, { outcome: 'failed' }>['reason']): Promise<BriefAudioOutcome> => {
    console.warn(`[brief-audio] failed reason=${reason} parts=${texts.length} spoken=${chars}`);
    // The row says failed first; a billing hiccup must not leave it in making.
    await db.from(Tables.DAILY_BRIEFS).update({ audio_status: 'failed', audio_updated_at: now().toISOString() })
      .eq('id', briefId).eq('user_id', userId).eq('audio_updated_at', stamp);
    await charge();
    return { outcome: 'failed', reason };
  };

  const buffers: Buffer[] = [];
  const parts: AudioPart[] = [];
  let cursor = 0;
  for (const [index, text] of texts.entries()) {
    let spoken: Buffer;
    try {
      spoken = await tts(text, persona);
    } catch {
      return fail('synthesis');
    }
    if (spoken.length === 0) return fail('no_voice');
    // Spoken, so billed: counted before anything after it can fail.
    chars += text.length;
    const frames = stripFrameMetadata(spoken);
    let seconds: number;
    try {
      seconds = await measure(frames);
    } catch {
      return fail('synthesis');
    }
    parts.push({ index, startSeconds: round2(cursor), text });
    buffers.push(frames);
    cursor += seconds;
  }

  // The object is named by its revision, so an older synthesis can never overwrite a newer one's file.
  const path = briefAudioPath(userId, briefId, stamp);
  // A refusal and a throw are the same to the brief: no audio this time.
  let uploadError: { message: string } | null;
  try {
    ({ error: uploadError } = await storage.upload(path, Buffer.concat(buffers), { contentType: 'audio/mpeg', upsert: true }));
  } catch {
    return fail('upload');
  }
  if (uploadError) return fail('upload');

  // Never ready without the ledger line the cap reads.
  if (!(await charge())) return fail('billing');

  const durationSeconds = round2(cursor);
  // Ready only now, and only while this synthesis still holds the claim: a brief re-made meanwhile
  // (saveBrief resets the claim) keeps the newer words' audio, never these.
  const { data: readied, error: saveError } = await db.from(Tables.DAILY_BRIEFS).update({
    audio_status: 'ready', audio_path: path, audio_parts: parts, audio_duration_seconds: durationSeconds, audio_chars: chars, audio_updated_at: now().toISOString(),
  }).eq('id', briefId).eq('user_id', userId).eq('audio_status', 'making').eq('audio_updated_at', stamp).select('id');
  if (saveError) return fail('save');
  if (!(readied as unknown[] | null)?.length) {
    console.warn(`[brief-audio] superseded parts=${texts.length}`);
    return { outcome: 'superseded' };
  }
  return { outcome: 'ready', path, durationSeconds, parts, chars };
}

type SpokenShape = Pick<BriefRowForAudio, 'kind' | 'through_line' | 'spine_movement' | 'items'>;

/**
 * Whether a re-made brief says something different, so its audio must be made
 * again. Compared as the spoken parts, not the stored JSON: jsonb reorders
 * object keys, so identical items can stringify differently, and v2 items are
 * bookkeeping that is never spoken (review, #138).
 */
export function briefWordsChanged(before: SpokenShape | null, after: SpokenShape): boolean {
  if (!before) return true;
  const a = briefPartsOf(before), b = briefPartsOf(after);
  return before.kind !== after.kind || a.length !== b.length || a.some((t, i) => t !== b[i]);
}

/** Marks a brief's audio failed after an unexpected throw, so a saved brief never stays `making`. */
export async function markAudioFailed(db: typeof supabase, userId: string, briefId: string, now = new Date()): Promise<void> {
  await db.from(Tables.DAILY_BRIEFS).update({ audio_status: 'failed', audio_updated_at: now.toISOString() })
    .eq('id', briefId).eq('user_id', userId).eq('audio_status', 'making');
}

/** The columns an upsert writes to start a brief's audio over. */
export const AUDIO_RESET = { audio_status: 'none', audio_path: null, audio_parts: [], audio_duration_seconds: null, audio_chars: null, audio_updated_at: null } as const;
