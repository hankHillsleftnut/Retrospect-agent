-- ============================================
-- 114_raw_content_retry.sql
--
-- Ingestion had no memory of having tried.
--
-- A row that failed was marked `failed` and nothing looked at it again. The
-- daily job that could have rescued it only considered content created in the
-- last seven days, so any failure that aged past a week became permanently
-- unreachable -- and the job itself was disabled in production, so in practice
-- nothing was ever retried at all. Two thousand entries died that way: not
-- because they could not be processed, but because a transient refusal was
-- recorded as a verdict.
--
-- These columns give a row the three things it needs to be picked up again on
-- its own: how many times it has been tried, when it is next due, and whether
-- the last failure was the environment's fault or its own.
-- ============================================

ALTER TABLE raw_content
    ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
    -- 'transient' -> worth retrying; 'terminal' -> sending it again changes nothing.
    ADD COLUMN IF NOT EXISTS failure_kind TEXT
        CHECK (failure_kind IS NULL OR failure_kind IN ('transient', 'terminal'));

-- The retry queue's own index. Deliberately partial: the overwhelming majority
-- of rows are completed and must not bloat it.
CREATE INDEX IF NOT EXISTS idx_raw_content_due_retry
    ON raw_content (user_id, next_attempt_at)
    WHERE processing_status = 'pending' AND next_attempt_at IS NOT NULL;

-- Finding rows abandoned mid-flight by a restart.
CREATE INDEX IF NOT EXISTS idx_raw_content_processing_started
    ON raw_content (processing_started_at)
    WHERE processing_status = 'processing';

-- Existing failures carry no attempt history, which would otherwise read as
-- "never tried" and let them retry the full six times. That is the intended
-- outcome for the backlog -- they genuinely have never been retried, because
-- the retry path did not run -- but it must be a deliberate choice rather than
-- an accident of defaulting, so it is left to an explicit backfill script
-- (scripts/requeue-failed.ts) which is bounded and reports its cost first.
COMMENT ON COLUMN raw_content.attempt_count IS
    'Ingestion attempts made. Rows that failed before this column existed read 0; requeue them deliberately via scripts/requeue-failed.ts, not implicitly.';
COMMENT ON COLUMN raw_content.next_attempt_at IS
    'When a pending row becomes eligible again. NULL means eligible immediately.';
COMMENT ON COLUMN raw_content.failure_kind IS
    'Whether the last failure was the environment''s fault (transient) or the content''s (terminal).';
