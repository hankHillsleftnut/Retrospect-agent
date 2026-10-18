-- ============================================================================
-- BASE SCHEMA SNAPSHOT — for tests only. Never applied to any real database.
--
-- A verbatim copy of retrospect-main/supabase/combined_migration.sql, vendored
-- here so the agent repo's migration tests can run in CI, where the other repo
-- is not checked out.
--
-- Why this file and not retrospect-main's numbered migrations 001–003: those
-- cannot be replayed. 001 and 003 declare four ivfflat indexes on 3072-dimension
-- columns, which pgvector refuses outright (its limit is 2,000), and no numbered
-- migration creates podcast_episodes at all. combined_migration.sql is the
-- corrected version — no impossible indexes, podcast_episodes included — and
-- matches what production actually holds. Found 18 October 2026.
--
-- Drift risk is low: retrospect-main has had no schema change since 003. If it
-- ever gains one, refresh this copy.
-- ============================================================================

-- ============================================================
-- RETROSPECT: COMPLETE DATABASE SETUP
-- Run this entire file in Supabase SQL Editor (one shot)
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================
-- 001: INITIAL SCHEMA
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    apple_user_id TEXT UNIQUE NOT NULL,
    email TEXT,
    voice_persona TEXT DEFAULT 'thoughtful_friend' CHECK (voice_persona IN ('thoughtful_friend', 'wise_mentor', 'energetic_host')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_apple_user_id ON users(apple_user_id);

CREATE TABLE IF NOT EXISTS data_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    extraction_prompt TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    parent_category_id UUID REFERENCES categories(id),
    color TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_category_id);

CREATE TABLE IF NOT EXISTS raw_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    content TEXT NOT NULL,
    content_date TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    processing_error TEXT,
    source_id UUID REFERENCES data_sources(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_raw_content_user_id ON raw_content(user_id);
CREATE INDEX IF NOT EXISTS idx_raw_content_status ON raw_content(processing_status);
CREATE INDEX IF NOT EXISTS idx_raw_content_type ON raw_content(content_type);
CREATE INDEX IF NOT EXISTS idx_raw_content_created ON raw_content(created_at DESC);

CREATE TABLE IF NOT EXISTS insight_units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    raw_content_id UUID REFERENCES raw_content(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    primary_category TEXT NOT NULL,
    secondary_categories TEXT[] DEFAULT '{}',
    is_inferred BOOLEAN DEFAULT false,
    confidence_score DECIMAL(3,2) DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    inference_reasoning TEXT,
    insight_date TIMESTAMPTZ NOT NULL,
    sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
    emotion_tags TEXT[] DEFAULT '{}',
    intensity DECIMAL(3,1) CHECK (intensity >= 1 AND intensity <= 10),
    embedding vector(3072),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insight_units_user_id ON insight_units(user_id);
CREATE INDEX IF NOT EXISTS idx_insight_units_category ON insight_units(primary_category);
CREATE INDEX IF NOT EXISTS idx_insight_units_date ON insight_units(insight_date DESC);
CREATE INDEX IF NOT EXISTS idx_insight_units_inferred ON insight_units(is_inferred);
CREATE INDEX IF NOT EXISTS idx_insight_units_sentiment ON insight_units(sentiment);
CREATE INDEX IF NOT EXISTS idx_insight_units_raw_content ON insight_units(raw_content_id);

CREATE TABLE IF NOT EXISTS insight_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_insight_id UUID NOT NULL REFERENCES insight_units(id) ON DELETE CASCADE,
    target_insight_id UUID NOT NULL REFERENCES insight_units(id) ON DELETE CASCADE,
    connection_type TEXT NOT NULL CHECK (connection_type IN ('same_topic', 'causal', 'temporal', 'supports', 'contradicts')),
    strength DECIMAL(3,2) DEFAULT 0.5 CHECK (strength >= 0 AND strength <= 1),
    reasoning TEXT,
    is_bidirectional BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_connection UNIQUE (source_insight_id, target_insight_id, connection_type)
);
CREATE INDEX IF NOT EXISTS idx_insight_connections_source ON insight_connections(source_insight_id);
CREATE INDEX IF NOT EXISTS idx_insight_connections_target ON insight_connections(target_insight_id);
CREATE INDEX IF NOT EXISTS idx_insight_connections_type ON insight_connections(connection_type);

CREATE TABLE IF NOT EXISTS patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    pattern_type TEXT NOT NULL CHECK (pattern_type IN ('correlation', 'trend', 'cycle', 'anomaly', 'habit')),
    categories TEXT[] DEFAULT '{}',
    supporting_insight_ids UUID[] DEFAULT '{}',
    confidence_score DECIMAL(3,2) DEFAULT 0.5 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    frequency TEXT CHECK (frequency IN ('daily', 'weekly', 'monthly', 'occasional', 'one_time')),
    time_range_start TIMESTAMPTZ,
    time_range_end TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    user_acknowledged BOOLEAN DEFAULT false,
    user_feedback TEXT CHECK (user_feedback IN ('confirmed', 'rejected', 'unsure')),
    feedback_notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_validated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_patterns_user_id ON patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_active ON patterns(is_active);
CREATE INDEX IF NOT EXISTS idx_patterns_created ON patterns(created_at DESC);

CREATE TABLE IF NOT EXISTS pattern_insights (
    pattern_id UUID NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
    insight_id UUID NOT NULL REFERENCES insight_units(id) ON DELETE CASCADE,
    relevance_score DECIMAL(3,2) DEFAULT 0.5,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (pattern_id, insight_id)
);
CREATE INDEX IF NOT EXISTS idx_pattern_insights_pattern ON pattern_insights(pattern_id);
CREATE INDEX IF NOT EXISTS idx_pattern_insights_insight ON pattern_insights(insight_id);

CREATE TABLE IF NOT EXISTS processing_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type TEXT NOT NULL CHECK (job_type IN ('extract_insights', 'generate_embeddings', 'find_connections', 'detect_patterns')),
    payload JSONB NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    priority INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON processing_queue(status);
CREATE INDEX IF NOT EXISTS idx_processing_queue_type ON processing_queue(job_type);
CREATE INDEX IF NOT EXISTS idx_processing_queue_priority ON processing_queue(priority DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS analytics_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cache_key TEXT NOT NULL,
    cache_value JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_cache_key UNIQUE (user_id, cache_key)
);
CREATE INDEX IF NOT EXISTS idx_analytics_cache_user ON analytics_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_cache_expires ON analytics_cache(expires_at);

-- Triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_insight_units_updated_at
    BEFORE UPDATE ON insight_units
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_patterns_updated_at
    BEFORE UPDATE ON patterns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE insight_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE insight_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON users FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users can update own profile" ON users FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Users can view own raw_content" ON raw_content FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can view own insight_units" ON insight_units FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can view own connections" ON insight_connections FOR ALL USING (source_insight_id IN (SELECT id FROM insight_units WHERE user_id = auth.uid()));
CREATE POLICY "Users can view own patterns" ON patterns FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can view own pattern_insights" ON pattern_insights FOR ALL USING (pattern_id IN (SELECT id FROM patterns WHERE user_id = auth.uid()));
CREATE POLICY "Users can view own analytics_cache" ON analytics_cache FOR ALL USING (user_id = auth.uid());

-- ============================================
-- 002: SEED CATEGORIES AND DATA SOURCES
-- ============================================

INSERT INTO categories (name, display_name, description, color, icon, sort_order) VALUES
    ('sleep', 'Sleep', 'Sleep quality, duration, patterns, and related issues', '#6366F1', 'moon.fill', 1),
    ('health', 'Health', 'Physical health, symptoms, medical appointments, and wellness', '#10B981', 'heart.fill', 2),
    ('mental_health', 'Mental Health', 'Emotional wellbeing, therapy, coping strategies', '#8B5CF6', 'brain.head.profile', 3),
    ('work', 'Work', 'Job tasks, projects, meetings, career development', '#F59E0B', 'briefcase.fill', 4),
    ('relationships', 'Relationships', 'Family, friends, romantic partners, social interactions', '#EC4899', 'person.2.fill', 5),
    ('productivity', 'Productivity', 'Task management, focus, efficiency, time management', '#3B82F6', 'checkmark.circle.fill', 6),
    ('finance', 'Finance', 'Money, budgeting, investments, expenses', '#059669', 'dollarsign.circle.fill', 7),
    ('creativity', 'Creativity', 'Art, writing, music, creative projects and ideas', '#F97316', 'paintbrush.fill', 8),
    ('learning', 'Learning', 'Education, skills development, courses, reading', '#14B8A6', 'book.fill', 9),
    ('fitness', 'Fitness', 'Exercise, workouts, physical activity, sports', '#EF4444', 'figure.run', 10),
    ('nutrition', 'Nutrition', 'Diet, meals, eating habits, supplements', '#84CC16', 'fork.knife', 11),
    ('spirituality', 'Spirituality', 'Meditation, mindfulness, beliefs, personal growth', '#A855F7', 'sparkles', 12),
    ('hobbies', 'Hobbies', 'Leisure activities, interests, personal projects', '#06B6D4', 'star.fill', 13),
    ('travel', 'Travel', 'Trips, vacations, commuting, places visited', '#0EA5E9', 'airplane', 14),
    ('home', 'Home', 'Living space, household tasks, family life at home', '#78716C', 'house.fill', 15)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    color = EXCLUDED.color,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order;

INSERT INTO data_sources (name, display_name, description, extraction_prompt) VALUES
    ('voice_recording', 'Voice Recording', 'Transcribed voice notes and audio journals', 'Extract atomic insight units from this voice transcript.'),
    ('text_entry', 'Text Entry', 'Written journal entries and notes', 'Extract atomic insight units from this written journal entry.'),
    ('google_docs', 'Google Docs', 'Documents from Google Drive', 'Extract atomic insight units from this Google Doc.'),
    ('healthkit', 'Apple HealthKit', 'Health and fitness data from Apple Health', 'Extract atomic insight units from this HealthKit data.'),
    ('calendar', 'Calendar', 'Calendar events and schedule data', 'Extract atomic insight units from this calendar data.'),
    ('twitter_bookmarks', 'Twitter Bookmarks', 'Saved tweets and threads', 'Extract atomic insight units from these Twitter bookmarks.')
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description;

-- ============================================
-- 003: GOALS, OBSERVATIONS, INSIGHTS PIPELINE
-- ============================================

CREATE TABLE IF NOT EXISTS goals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    embedding vector(3072),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goals_user_id ON goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_active ON goals(user_id, is_active);

CREATE TABLE IF NOT EXISTS observations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    raw_content_id UUID REFERENCES raw_content(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    reason_why TEXT NOT NULL,
    confidence_score DECIMAL(3,2) DEFAULT 0.8 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    observation_date TIMESTAMPTZ NOT NULL,
    embedding vector(3072),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_observations_user_id ON observations(user_id);
CREATE INDEX IF NOT EXISTS idx_observations_goal_id ON observations(goal_id);
CREATE INDEX IF NOT EXISTS idx_observations_date ON observations(observation_date DESC);
CREATE INDEX IF NOT EXISTS idx_observations_raw_content ON observations(raw_content_id);

CREATE TABLE IF NOT EXISTS insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    evidence_summary TEXT NOT NULL,
    supporting_observation_ids UUID[] DEFAULT '{}',
    confidence_score DECIMAL(3,2) DEFAULT 0.7 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    time_range_start TIMESTAMPTZ,
    time_range_end TIMESTAMPTZ,
    embedding vector(3072),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insights_user_id ON insights(user_id);
CREATE INDEX IF NOT EXISTS idx_insights_goal_id ON insights(goal_id);
CREATE INDEX IF NOT EXISTS idx_insights_created ON insights(created_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_type TEXT NOT NULL CHECK (run_type IN ('observation_extraction', 'insight_generation', 'full_pipeline')),
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    raw_content_ids UUID[] DEFAULT '{}',
    observations_created INTEGER DEFAULT 0,
    insights_created INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user ON pipeline_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);

CREATE TRIGGER update_goals_updated_at
    BEFORE UPDATE ON goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_insights_updated_at
    BEFORE UPDATE ON insights
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own goals" ON goals FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can view own observations" ON observations FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can view own insights" ON insights FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users can view own pipeline_runs" ON pipeline_runs FOR ALL USING (user_id = auth.uid());

-- ============================================
-- DATABASE FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION match_observations(
    query_embedding vector(3072),
    match_threshold float,
    match_count int,
    filter_user_id uuid,
    filter_goal_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid, content text, reason_why text, goal_id uuid,
    observation_date timestamptz, similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT o.id, o.content, o.reason_why, o.goal_id, o.observation_date,
        1 - (o.embedding <=> query_embedding) AS similarity
    FROM observations o
    WHERE o.user_id = filter_user_id
      AND o.embedding IS NOT NULL
      AND (filter_goal_id IS NULL OR o.goal_id = filter_goal_id)
      AND 1 - (o.embedding <=> query_embedding) > match_threshold
    ORDER BY o.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_user_insights(
    query_embedding vector(3072),
    match_threshold float,
    match_count int,
    filter_user_id uuid,
    filter_goal_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid, title text, content text, evidence_summary text,
    goal_id uuid, confidence_score decimal, created_at timestamptz, similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT i.id, i.title, i.content, i.evidence_summary, i.goal_id,
        i.confidence_score, i.created_at,
        1 - (i.embedding <=> query_embedding) AS similarity
    FROM insights i
    WHERE i.user_id = filter_user_id
      AND i.embedding IS NOT NULL
      AND (filter_goal_id IS NULL OR i.goal_id = filter_goal_id)
      AND 1 - (i.embedding <=> query_embedding) > match_threshold
    ORDER BY i.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_insights(
    query_embedding vector(3072),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10,
    filter_user_id uuid DEFAULT NULL,
    filter_category text DEFAULT NULL,
    exclude_insight_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid, content text, primary_category text, secondary_categories text[],
    insight_date timestamptz, sentiment text, is_inferred boolean, similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT iu.id, iu.content, iu.primary_category, iu.secondary_categories,
        iu.insight_date, iu.sentiment, iu.is_inferred,
        1 - (iu.embedding <=> query_embedding) AS similarity
    FROM insight_units iu
    WHERE iu.embedding IS NOT NULL
        AND (filter_user_id IS NULL OR iu.user_id = filter_user_id)
        AND (filter_category IS NULL OR iu.primary_category = filter_category)
        AND (exclude_insight_id IS NULL OR iu.id != exclude_insight_id)
        AND 1 - (iu.embedding <=> query_embedding) > match_threshold
    ORDER BY iu.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION search_insights_in_range(
    query_embedding vector(3072),
    p_user_id uuid,
    start_date timestamptz,
    end_date timestamptz,
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 50
)
RETURNS TABLE (
    id uuid, content text, primary_category text, insight_date timestamptz,
    sentiment text, intensity decimal, similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT iu.id, iu.content, iu.primary_category, iu.insight_date,
        iu.sentiment, iu.intensity,
        1 - (iu.embedding <=> query_embedding) AS similarity
    FROM insight_units iu
    WHERE iu.user_id = p_user_id
        AND iu.embedding IS NOT NULL
        AND iu.insight_date >= start_date
        AND iu.insight_date <= end_date
        AND 1 - (iu.embedding <=> query_embedding) > match_threshold
    ORDER BY iu.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_category_insights(
    p_user_id uuid,
    p_category text,
    p_days_back int DEFAULT 30,
    p_limit int DEFAULT 100
)
RETURNS TABLE (
    id uuid, content text, insight_date timestamptz, sentiment text,
    intensity decimal, emotion_tags text[], is_inferred boolean
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT iu.id, iu.content, iu.insight_date, iu.sentiment,
        iu.intensity, iu.emotion_tags, iu.is_inferred
    FROM insight_units iu
    WHERE iu.user_id = p_user_id
        AND (iu.primary_category = p_category OR p_category = ANY(iu.secondary_categories))
        AND iu.insight_date >= NOW() - (p_days_back || ' days')::interval
    ORDER BY iu.insight_date DESC
    LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION get_insight_connections(
    p_insight_id uuid,
    p_depth int DEFAULT 1
)
RETURNS TABLE (
    source_id uuid, source_content text, target_id uuid, target_content text,
    connection_type text, strength decimal, reasoning text
)
LANGUAGE sql AS $$
    WITH RECURSIVE connection_graph AS (
        SELECT ic.source_insight_id, ic.target_insight_id, ic.connection_type,
            ic.strength, ic.reasoning, 1 as depth
        FROM insight_connections ic
        WHERE ic.source_insight_id = p_insight_id OR ic.target_insight_id = p_insight_id
        UNION ALL
        SELECT ic.source_insight_id, ic.target_insight_id, ic.connection_type,
            ic.strength, ic.reasoning, cg.depth + 1
        FROM insight_connections ic
        JOIN connection_graph cg ON (ic.source_insight_id = cg.target_insight_id OR ic.target_insight_id = cg.source_insight_id)
        WHERE cg.depth < p_depth
    )
    SELECT DISTINCT cg.source_insight_id, src.content, cg.target_insight_id, tgt.content,
        cg.connection_type, cg.strength, cg.reasoning
    FROM connection_graph cg
    JOIN insight_units src ON src.id = cg.source_insight_id
    JOIN insight_units tgt ON tgt.id = cg.target_insight_id;
$$;

CREATE OR REPLACE FUNCTION get_user_stats(
    p_user_id uuid,
    p_days_back int DEFAULT 30
)
RETURNS TABLE (
    total_insights bigint, insights_by_category jsonb, sentiment_distribution jsonb,
    avg_intensity decimal, inferred_ratio decimal, total_patterns bigint, active_patterns bigint
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM insight_units WHERE user_id = p_user_id AND insight_date >= NOW() - (p_days_back || ' days')::interval),
        (SELECT jsonb_object_agg(primary_category, cnt) FROM (SELECT primary_category, COUNT(*) as cnt FROM insight_units WHERE user_id = p_user_id AND insight_date >= NOW() - (p_days_back || ' days')::interval GROUP BY primary_category) sub),
        (SELECT jsonb_object_agg(COALESCE(sentiment, 'unknown'), cnt) FROM (SELECT sentiment, COUNT(*) as cnt FROM insight_units WHERE user_id = p_user_id AND insight_date >= NOW() - (p_days_back || ' days')::interval GROUP BY sentiment) sub),
        (SELECT AVG(intensity) FROM insight_units WHERE user_id = p_user_id AND insight_date >= NOW() - (p_days_back || ' days')::interval AND intensity IS NOT NULL),
        (SELECT COUNT(*)::decimal / NULLIF(COUNT(*) FILTER (WHERE NOT is_inferred), 0) FROM insight_units WHERE user_id = p_user_id AND insight_date >= NOW() - (p_days_back || ' days')::interval),
        (SELECT COUNT(*) FROM patterns WHERE user_id = p_user_id),
        (SELECT COUNT(*) FROM patterns WHERE user_id = p_user_id AND is_active = true);
END;
$$;

-- ============================================
-- PODCAST EPISODES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS podcast_episodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    script TEXT NOT NULL,
    audio_url TEXT,
    duration_seconds INTEGER,
    mood TEXT,
    generation_type TEXT DEFAULT 'weekly' CHECK (generation_type IN ('weekly', 'on_demand', 'milestone')),
    status TEXT DEFAULT 'generating' CHECK (status IN ('generating', 'ready', 'failed')),
    -- What went into this episode
    insight_ids UUID[] DEFAULT '{}',
    goal_ids UUID[] DEFAULT '{}',
    research_citations JSONB DEFAULT '[]',
    outline JSONB DEFAULT '{}',
    -- Episode metadata
    episode_number INTEGER,
    covers_period_start TIMESTAMPTZ,
    covers_period_end TIMESTAMPTZ,
    previous_episode_id UUID REFERENCES podcast_episodes(id),
    -- Tracking
    topics_covered TEXT[] DEFAULT '{}',
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_podcast_episodes_user ON podcast_episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_podcast_episodes_status ON podcast_episodes(status);
CREATE INDEX IF NOT EXISTS idx_podcast_episodes_created ON podcast_episodes(created_at DESC);

ALTER TABLE podcast_episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own episodes" ON podcast_episodes FOR ALL USING (user_id = auth.uid());

CREATE TRIGGER update_podcast_episodes_updated_at
    BEFORE UPDATE ON podcast_episodes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- DONE! All tables, functions, and policies created.
-- ============================================
