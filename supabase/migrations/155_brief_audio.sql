-- ============================================================================
-- 155: brief audio (BE1.3b)
--
-- Briefs are audio (founder, 21 Oct). After a non-quiet brief is saved the
-- brain speaks it one part at a time, measures each part, joins them and puts
-- the file in a PRIVATE bucket of its own; the backend signs a link that
-- expires (contract 02 §3, BE1.3-BE1.4 pass §1.4).
--
--   audio_status            none -> making -> ready | failed; 'ready' is set only
--                           after the upload returned
--   audio_path              the object path in brief-audio: <user_id>/<brief id>.mp3
--   audio_duration_seconds  measured from the file, not estimated
--   audio_parts             [{ index, startSeconds, text }]: exactly what was spoken,
--                           so the door's parts are these and never re-split
--   audio_chars             characters sent to the voice (what it cost)
--
-- The bucket is private from the start: brief-audio, objects audio/mpeg.
-- Additive; re-runnable.
-- ============================================================================

ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS audio_path TEXT;
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS audio_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS audio_duration_seconds NUMERIC(8, 2);
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS audio_parts JSONB NOT NULL DEFAULT '[]';
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS audio_chars INTEGER;
ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS audio_updated_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE daily_briefs ADD CONSTRAINT daily_briefs_audio_status_check
    CHECK (audio_status IN ('none', 'making', 'ready', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('brief-audio', 'brief-audio', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

COMMENT ON COLUMN daily_briefs.audio_parts IS 'What was spoken, in order: [{ index, startSeconds, text }] (BE1.3b).';
