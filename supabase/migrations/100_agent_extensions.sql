-- ============================================
-- 100_agent_extensions.sql
-- Additive migration for the retrospect-agent project.
-- All changes are non-breaking for the existing Retrospect backend.
-- ============================================

-- ------------------------------------------------------------
-- observations: allow goal-less observations (System A may
-- extract observations that don't yet map to an active goal —
-- per the meeting: "There are the observations that are not
-- relevant to current goals. But there we can still save them.")
-- ------------------------------------------------------------
ALTER TABLE observations ALTER COLUMN goal_id DROP NOT NULL;

ALTER TABLE observations
    ADD COLUMN IF NOT EXISTS is_goal_candidate BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_observations_goal_candidate
    ON observations(user_id, is_goal_candidate)
    WHERE is_goal_candidate = true;

-- ------------------------------------------------------------
-- raw_content: add an embedding column so the agent's
-- last-resort search_raw_content tool can vector-search user quotes.
-- New raw_content from this project will be embedded on ingest;
-- existing rows will have NULL embedding until backfilled.
-- ------------------------------------------------------------
ALTER TABLE raw_content
    ADD COLUMN IF NOT EXISTS embedding vector(3072);

-- NOTE: no ivfflat index on raw_content.embedding because pgvector's
-- ivfflat type maxes out at 2000 dimensions and we use 3072.
-- Searches over raw_content will sequential-scan — fine for tables under
-- ~10k rows. If raw_content grows past that, consider a halfvec column
-- or an hnsw index on a derived 1024-dim summary.

-- ------------------------------------------------------------
-- podcast_episodes: add the rich summary that the next week's
-- agent will embedding-search via the search_previous_podcasts tool.
-- ------------------------------------------------------------
ALTER TABLE podcast_episodes
    ADD COLUMN IF NOT EXISTS summary TEXT;

ALTER TABLE podcast_episodes
    ADD COLUMN IF NOT EXISTS summary_embedding vector(3072);

-- ------------------------------------------------------------
-- user_preferences: tone, trusted voice, focus areas, etc.
-- Built up over time from explicit settings + post-episode feedback.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- structured fields (kept simple so the LLM can read them as text)
    tone TEXT,                          -- e.g. "direct, compassionate, no toxic positivity"
    trusted_voice_description TEXT,     -- e.g. "older brother who's been through it"
    focus_areas TEXT[] DEFAULT '{}',    -- e.g. ['fitness', 'creative work']
    avoid_topics TEXT[] DEFAULT '{}',
    -- free-form do/don't directives appended by feedback over time
    directives JSONB DEFAULT '[]',      -- [{date, text, source: 'feedback'|'manual'}]
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);

-- ------------------------------------------------------------
-- goal_candidates: things the system noticed look like goals
-- but the user hasn't confirmed yet. iOS app surfaces these later.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goal_candidates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    reasoning TEXT NOT NULL,            -- why the system thinks this is a goal
    supporting_observation_ids UUID[] DEFAULT '{}',
    confidence_score DECIMAL(3,2) DEFAULT 0.5 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'merged')),
    accepted_as_goal_id UUID REFERENCES goals(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goal_candidates_user ON goal_candidates(user_id, status);

-- ------------------------------------------------------------
-- episode_feedback: post-episode response (voice or text) that
-- gets folded into user_preferences and Pass C of the next run.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS episode_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    episode_id UUID NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
    feedback_text TEXT NOT NULL,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'voice', 'tap')),
    processed BOOLEAN DEFAULT false,   -- has it been folded into user_preferences yet?
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_episode_feedback_user ON episode_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_episode_feedback_episode ON episode_feedback(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_feedback_unprocessed ON episode_feedback(user_id, processed) WHERE processed = false;

-- ------------------------------------------------------------
-- Row-level security
-- ------------------------------------------------------------
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own preferences" ON user_preferences
    FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Users can view own goal candidates" ON goal_candidates
    FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Users can manage own episode feedback" ON episode_feedback
    FOR ALL USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- Triggers
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_goal_candidates_updated_at ON goal_candidates;
CREATE TRIGGER update_goal_candidates_updated_at
    BEFORE UPDATE ON goal_candidates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- Embedding search function for past podcast summaries
-- (used by the search_previous_podcasts agent tool)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_podcast_summaries(
    query_embedding vector(3072),
    match_threshold float,
    match_count int,
    filter_user_id uuid
)
RETURNS TABLE (
    id uuid,
    title text,
    description text,
    summary text,
    created_at timestamptz,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.title,
        p.description,
        p.summary,
        p.created_at,
        1 - (p.summary_embedding <=> query_embedding) AS similarity
    FROM podcast_episodes p
    WHERE p.user_id = filter_user_id
      AND p.summary_embedding IS NOT NULL
      AND p.status = 'ready'
      AND 1 - (p.summary_embedding <=> query_embedding) > match_threshold
    ORDER BY p.summary_embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ------------------------------------------------------------
-- Embedding search function for raw_content (last-resort tool)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_raw_content(
    query_embedding vector(3072),
    match_threshold float,
    match_count int,
    filter_user_id uuid,
    start_date timestamptz DEFAULT NULL,
    end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    content text,
    content_type text,
    content_date timestamptz,
    created_at timestamptz,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id,
        r.content,
        r.content_type,
        r.content_date,
        r.created_at,
        1 - (r.embedding <=> query_embedding) AS similarity
    FROM raw_content r
    WHERE r.user_id = filter_user_id
      AND r.embedding IS NOT NULL
      AND (start_date IS NULL OR COALESCE(r.content_date, r.created_at) >= start_date)
      AND (end_date IS NULL OR COALESCE(r.content_date, r.created_at) <= end_date)
      AND 1 - (r.embedding <=> query_embedding) > match_threshold
    ORDER BY r.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
