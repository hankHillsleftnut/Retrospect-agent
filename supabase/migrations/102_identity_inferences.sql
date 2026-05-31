-- ============================================
-- 102_identity_inferences.sql
-- First-class storage for identity inferences — claims about
-- WHO the user is (vs. observations, which capture what happened).
-- Produced by the ingestion agent and consumed by Cook 0 + Cook B.
-- ============================================

CREATE TABLE IF NOT EXISTS identity_inferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The inference itself
    content TEXT NOT NULL,

    -- Taxonomy: known domains plus 'emerging' for Cook-0-invented categories
    -- (with the actual label stored in domain_label when domain = 'emerging')
    domain TEXT NOT NULL CHECK (domain IN (
        'self_concept',
        'emotional',
        'work_achievement',
        'relational',
        'physical',
        'cognitive',
        'emerging'
    )),
    domain_label TEXT, -- used when domain = 'emerging' to name the new category

    confidence_score NUMERIC(3, 2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    is_provisional BOOLEAN NOT NULL DEFAULT true,

    -- Provenance
    evidence_summary TEXT,
    supporting_raw_content_ids UUID[] DEFAULT '{}',
    supporting_observation_ids UUID[] DEFAULT '{}',

    -- Lifecycle
    superseded_by UUID REFERENCES identity_inferences(id) ON DELETE SET NULL,
    corroborated_by UUID[] DEFAULT '{}',
    retired_at TIMESTAMPTZ,
    retirement_reason TEXT,

    -- Vector search (3072 to match other embedding columns)
    embedding vector(3072),

    -- Bookkeeping
    source_ingestion_run_id UUID REFERENCES pipeline_run_traces(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Active = not superseded and not retired
CREATE INDEX IF NOT EXISTS idx_identity_inferences_user_active
    ON identity_inferences(user_id, confidence_score DESC)
    WHERE superseded_by IS NULL AND retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_identity_inferences_user_domain
    ON identity_inferences(user_id, domain);

CREATE INDEX IF NOT EXISTS idx_identity_inferences_user_provisional
    ON identity_inferences(user_id, is_provisional, created_at DESC)
    WHERE superseded_by IS NULL AND retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_identity_inferences_run
    ON identity_inferences(source_ingestion_run_id);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE identity_inferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own identity inferences" ON identity_inferences
    FOR ALL USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- updated_at trigger
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS update_identity_inferences_updated_at ON identity_inferences;
CREATE TRIGGER update_identity_inferences_updated_at
    BEFORE UPDATE ON identity_inferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- Vector search RPC (used by Cook B's search_identity_inferences tool)
-- pgvector ivfflat tops out at 2000 dims, and we use 3072 — so this
-- sequential-scans like match_raw_content. Fine for tables under ~10k rows.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_identity_inferences(
    query_embedding vector(3072),
    match_threshold float,
    match_count int,
    filter_user_id uuid,
    filter_domain text DEFAULT NULL,
    filter_min_confidence float DEFAULT 0.0,
    filter_include_provisional boolean DEFAULT true
)
RETURNS TABLE (
    id uuid,
    content text,
    domain text,
    domain_label text,
    confidence_score numeric,
    is_provisional boolean,
    evidence_summary text,
    created_at timestamptz,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        i.id,
        i.content,
        i.domain,
        i.domain_label,
        i.confidence_score,
        i.is_provisional,
        i.evidence_summary,
        i.created_at,
        1 - (i.embedding <=> query_embedding) AS similarity
    FROM identity_inferences i
    WHERE i.user_id = filter_user_id
      AND i.embedding IS NOT NULL
      AND i.superseded_by IS NULL
      AND i.retired_at IS NULL
      AND i.confidence_score >= filter_min_confidence
      AND (filter_domain IS NULL OR i.domain = filter_domain)
      AND (filter_include_provisional OR i.is_provisional = false)
      AND 1 - (i.embedding <=> query_embedding) > match_threshold
    ORDER BY i.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
