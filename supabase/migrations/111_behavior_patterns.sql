-- ============================================
-- 111_behavior_patterns.sql
-- Patterns as a FIRST-CLASS, PERSISTENT object.
--
-- Deliberately NOT the legacy `patterns` table, which is correlation/trend
-- detection over insight_units -- a different object with a different job and
-- possibly a live cron still writing it (docs/second-brain/04 §4, 05 D4).
--
-- A Pattern is promoted, never invented. Cook B must not mint one.
-- ============================================

CREATE TABLE IF NOT EXISTS behavior_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Boring machine name. Poetic labels break typed retrieval (05 D5).
    slug TEXT NOT NULL,
    label TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'candidate'
        CHECK (status IN ('candidate', 'live', 'retired', 'user_rejected')),
    severity TEXT NOT NULL DEFAULT 'standard'
        CHECK (severity IN ('standard', 'high', 'extreme')),

    -- Extreme content is stored, never narrated unasked (01 Example D, 05 D10).
    episode_promotable BOOLEAN NOT NULL DEFAULT true,

    first_seen_at TIMESTAMPTZ,
    last_seen_at  TIMESTAMPTZ,
    instance_count INTEGER NOT NULL DEFAULT 0,
    -- Instances weighted by source cadence: three calendar rows are not three
    -- journals. Without this a noisy connector manufactures patterns.
    weighted_count NUMERIC(6,2) NOT NULL DEFAULT 0,
    source_count INTEGER NOT NULL DEFAULT 0,

    -- Falls as evidence goes stale, so a loop someone stopped can die.
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    subject_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,

    grouping_key TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    promoter_version TEXT NOT NULL DEFAULT 'v1',
    source_run_id UUID REFERENCES pipeline_run_traces(id) ON DELETE SET NULL,

    promoted_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ,
    retirement_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, grouping_key)
);

CREATE INDEX IF NOT EXISTS idx_behavior_patterns_live
    ON behavior_patterns(user_id, last_seen_at DESC)
    WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_behavior_patterns_status
    ON behavior_patterns(user_id, status);

CREATE TABLE IF NOT EXISTS behavior_pattern_facts (
    pattern_id UUID NOT NULL REFERENCES behavior_patterns(id) ON DELETE CASCADE,
    assertion_id UUID NOT NULL REFERENCES assertions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'supports'
        CHECK (role IN ('supports', 'weakly_related', 'counter_evidence')),
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pattern_id, assertion_id)
);

CREATE INDEX IF NOT EXISTS idx_pattern_facts_assertion
    ON behavior_pattern_facts(assertion_id);

-- A Why exists ONLY on a live Pattern, and is always labelled inferred.
-- User-stated reasons are Facts (said_about_self), never rows here (01 Q5).
CREATE TABLE IF NOT EXISTS behavior_pattern_whys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_id UUID NOT NULL REFERENCES behavior_patterns(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    kind TEXT NOT NULL DEFAULT 'inferred' CHECK (kind = 'inferred'),
    mechanism TEXT NOT NULL
        CHECK (mechanism IN ('avoidance', 'ambivalence', 'capacity', 'unclear')),
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0.3,
    status TEXT NOT NULL DEFAULT 'provisional'
        CHECK (status IN ('provisional', 'live', 'retired', 'user_rejected')),
    evidence_assertion_ids UUID[] NOT NULL DEFAULT '{}',
    model_version TEXT,
    retired_at TIMESTAMPTZ,
    retirement_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pattern_whys_pattern
    ON behavior_pattern_whys(pattern_id)
    WHERE retired_at IS NULL;

ALTER TABLE behavior_patterns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_pattern_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_pattern_whys  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own behavior_patterns" ON behavior_patterns
    FOR ALL USING (user_id = auth.uid());
CREATE POLICY "own behavior_pattern_facts" ON behavior_pattern_facts
    FOR ALL USING (user_id = auth.uid());
CREATE POLICY "own behavior_pattern_whys" ON behavior_pattern_whys
    FOR ALL USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_behavior_patterns_updated_at ON behavior_patterns;
CREATE TRIGGER update_behavior_patterns_updated_at
    BEFORE UPDATE ON behavior_patterns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE behavior_patterns IS
    'Repeated behaviour, promoted after a bar is met. NOT the legacy patterns table.';
COMMENT ON COLUMN behavior_patterns.episode_promotable IS
    'False for extreme severity: stored as knowledge, never narrated unasked.';
COMMENT ON COLUMN behavior_patterns.weighted_count IS
    'Instances weighted by source cadence, so a high-volume connector cannot manufacture a pattern.';
