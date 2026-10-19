-- 128: the daily brief (goals 11, 13-16; docs/second-brain/brief-phase-5-coherence.md).
--
-- One brief per person per day, built around the one answer about them that
-- moved most (the "spine"). Text first; audio later. Stored so the app can show
-- it and so a later brief can avoid repeating a spine.
--
-- Additive: one new table, one new column with a default. The brief is OFF by
-- default per person (goal-specs: "a product that starts speaking to you every
-- morning before you asked is the version that gets deleted").

ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_brief_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS daily_briefs (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brief_date         DATE NOT NULL,
    -- 'brief' (has a through-line) or 'quiet' (nothing moved; a short note, never padded)
    kind               TEXT NOT NULL CHECK (kind IN ('brief', 'quiet')),
    through_line       TEXT NOT NULL,
    spine_question_id  SMALLINT REFERENCES canonical_questions(id),
    spine_movement     TEXT,
    -- [{ text, why, quote, source_ref }] -- every quote verified present in its source
    items              JSONB NOT NULL DEFAULT '[]',
    dropped            INTEGER NOT NULL DEFAULT 0,
    model_version      TEXT,
    cost_usd           NUMERIC(8, 4) NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, brief_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_briefs_user_date ON daily_briefs(user_id, brief_date DESC);

ALTER TABLE daily_briefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON daily_briefs FROM anon, authenticated;

COMMENT ON TABLE daily_briefs IS
    'One daily brief per person per day, built around the answer that moved most. Text first.';
