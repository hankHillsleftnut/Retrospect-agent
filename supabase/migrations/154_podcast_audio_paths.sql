-- ============================================================================
-- 154: episode audio by object path, not public URL (BEA.7)
--
-- Goal: private audio, signed links.
--
-- Why: podcast_episodes.audio_url is a public, permanent URL with the person's
-- id in the path. The brain now stores the object path and signs a link that
-- expires (src/services/audio-storage.ts); audio_url keeps being written for
-- app versions before X07 and is dropped with them.
--
-- Backfill: the path is what follows ".../storage/v1/object/public/podcast-audio/"
-- in the public URL (the same rule as audioPathFromPublicUrl). Rows whose URL
-- is not one of ours are left null. Additive; re-runnable.
-- ============================================================================

ALTER TABLE podcast_episodes ADD COLUMN IF NOT EXISTS audio_path TEXT;

UPDATE podcast_episodes
   SET audio_path = split_part(substring(audio_url from '/storage/v1/object/public/podcast-audio/(.+)$'), '?', 1)
 WHERE audio_path IS NULL
   AND audio_url ~ '/storage/v1/object/public/podcast-audio/.+';

COMMENT ON COLUMN podcast_episodes.audio_path IS 'Object path in the podcast-audio bucket; links are signed from it (BEA.7).';
