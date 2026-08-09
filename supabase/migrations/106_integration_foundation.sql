-- Agent-owned integration collection and provenance foundation.
-- Provider payloads and normalized source items remain immutable/auditable;
-- raw_content is the compatibility projection consumed by the intelligence pipeline.

CREATE TABLE IF NOT EXISTS integration_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    collection_mode TEXT NOT NULL CHECK (collection_mode IN ('native_ios', 'oauth_api', 'data_export')),
    status TEXT NOT NULL DEFAULT 'connected'
        CHECK (status IN ('connected', 'action_required', 'expired', 'disconnected', 'error')),
    granted_scopes TEXT[] NOT NULL DEFAULT '{}',
    provider_account_id TEXT,
    provider_account_label TEXT,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_verified_at TIMESTAMPTZ,
    disconnected_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, provider_id)
);

CREATE TABLE IF NOT EXISTS integration_sync_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL UNIQUE REFERENCES integration_connections(id) ON DELETE CASCADE,
    cursor JSONB NOT NULL DEFAULT '{}',
    watermark TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL CHECK (job_type IN ('initial_backfill', 'incremental_sync', 'webhook_recovery', 'replay', 'export_import')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'leased', 'running', 'completed', 'failed', 'cancelled')),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    leased_until TIMESTAMPTZ,
    lease_owner TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    payload JSONB NOT NULL DEFAULT '{}',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_jobs_available
    ON integration_jobs(status, available_at)
    WHERE status IN ('queued', 'leased');

CREATE TABLE IF NOT EXISTS integration_sync_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    job_id UUID REFERENCES integration_jobs(id) ON DELETE SET NULL,
    run_type TEXT NOT NULL CHECK (run_type IN ('initial_backfill', 'incremental_sync', 'webhook_recovery', 'replay', 'export_import')),
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'partial', 'failed', 'cancelled')),
    cursor_before JSONB NOT NULL DEFAULT '{}',
    cursor_after JSONB NOT NULL DEFAULT '{}',
    items_seen INTEGER NOT NULL DEFAULT 0,
    items_created INTEGER NOT NULL DEFAULT 0,
    items_updated INTEGER NOT NULL DEFAULT 0,
    items_deleted INTEGER NOT NULL DEFAULT 0,
    items_skipped INTEGER NOT NULL DEFAULT 0,
    error_summary JSONB NOT NULL DEFAULT '{}',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_integration_sync_runs_connection
    ON integration_sync_runs(connection_id, started_at DESC);

CREATE TABLE IF NOT EXISTS source_payloads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    sync_run_id UUID REFERENCES integration_sync_runs(id) ON DELETE SET NULL,
    provider_object_type TEXT NOT NULL,
    provider_object_id TEXT,
    payload JSONB NOT NULL,
    payload_hash TEXT NOT NULL,
    provider_created_at TIMESTAMPTZ,
    provider_updated_at TIMESTAMPTZ,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    parser_version TEXT,
    UNIQUE (connection_id, provider_object_type, provider_object_id, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_source_payloads_connection
    ON source_payloads(connection_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS source_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    latest_payload_id UUID REFERENCES source_payloads(id) ON DELETE SET NULL,
    provider_object_type TEXT NOT NULL,
    provider_object_id TEXT NOT NULL,
    canonical_type TEXT NOT NULL,
    canonical_text TEXT,
    analysis_eligible BOOLEAN NOT NULL DEFAULT TRUE,
    normalized_data JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ,
    provider_created_at TIMESTAMPTZ,
    provider_updated_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    normalizer_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (connection_id, provider_object_type, provider_object_id)
);

CREATE INDEX IF NOT EXISTS idx_source_items_user_time
    ON source_items(user_id, occurred_at DESC);

ALTER TABLE source_items
    ADD COLUMN IF NOT EXISTS analysis_eligible BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS source_item_relations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_source_item_id UUID NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
    to_source_item_id UUID NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (from_source_item_id, to_source_item_id, relation_type)
);

CREATE TABLE IF NOT EXISTS analysis_units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_item_id UUID NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
    unit_type TEXT NOT NULL,
    content TEXT NOT NULL,
    structured_data JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ,
    sequence_index INTEGER NOT NULL DEFAULT 0,
    analyzer_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_item_id, unit_type, sequence_index, analyzer_version)
);

CREATE TABLE IF NOT EXISTS evidence_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    analysis_unit_id UUID NOT NULL REFERENCES analysis_units(id) ON DELETE CASCADE,
    derived_type TEXT NOT NULL,
    derived_id UUID NOT NULL,
    relationship TEXT NOT NULL DEFAULT 'evidence_for',
    confidence NUMERIC(4, 3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    source_run_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (analysis_unit_id, derived_type, derived_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_evidence_links_derived
    ON evidence_links(user_id, derived_type, derived_id);

CREATE TABLE IF NOT EXISTS integration_test_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id TEXT NOT NULL,
    connection_id UUID REFERENCES integration_connections(id) ON DELETE CASCADE,
    test_suite TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'warning')),
    checks JSONB NOT NULL DEFAULT '[]',
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

ALTER TABLE raw_content ADD COLUMN IF NOT EXISTS source_item_id UUID REFERENCES source_items(id) ON DELETE SET NULL;
ALTER TABLE raw_content ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_content_source_item
    ON raw_content(source_item_id)
    WHERE source_item_id IS NOT NULL;

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_item_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_test_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integration_connections' AND policyname = 'Users can view own integration connections') THEN
        CREATE POLICY "Users can view own integration connections" ON integration_connections FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'source_items' AND policyname = 'Users can view own source items') THEN
        CREATE POLICY "Users can view own source items" ON source_items FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'source_item_relations' AND policyname = 'Users can view own source item relations') THEN
        CREATE POLICY "Users can view own source item relations" ON source_item_relations FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'analysis_units' AND policyname = 'Users can view own analysis units') THEN
        CREATE POLICY "Users can view own analysis units" ON analysis_units FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'evidence_links' AND policyname = 'Users can view own evidence links') THEN
        CREATE POLICY "Users can view own evidence links" ON evidence_links FOR SELECT USING (user_id = auth.uid());
    END IF;
END $$;

DROP TRIGGER IF EXISTS update_integration_connections_updated_at ON integration_connections;
CREATE TRIGGER update_integration_connections_updated_at
    BEFORE UPDATE ON integration_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_source_items_updated_at ON source_items;
CREATE TRIGGER update_source_items_updated_at
    BEFORE UPDATE ON source_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Remove the pre-agent-foundation signature if the earlier public API migration
-- was applied first. The new signature adds explicit analysis eligibility.
DROP FUNCTION IF EXISTS ingest_integration_source_item(
    UUID, TEXT, TEXT, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB,
    TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB
);

CREATE OR REPLACE FUNCTION ingest_integration_source_item(
    p_user_id UUID,
    p_provider_id TEXT,
    p_collection_mode TEXT,
    p_sync_run_id UUID,
    p_provider_object_type TEXT,
    p_provider_object_id TEXT,
    p_payload JSONB,
    p_payload_hash TEXT,
    p_canonical_type TEXT,
    p_canonical_text TEXT,
    p_normalized_data JSONB,
    p_occurred_at TIMESTAMPTZ,
    p_analysis_eligible BOOLEAN,
    p_provider_created_at TIMESTAMPTZ,
    p_provider_updated_at TIMESTAMPTZ,
    p_parser_version TEXT,
    p_normalizer_version TEXT,
    p_content_type TEXT,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE (source_item_id UUID, raw_content_id UUID, item_created BOOLEAN, content_changed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_connection_id UUID;
    v_payload_id UUID;
    v_existing_item_id UUID;
    v_previous_payload_id UUID;
    v_source_item_id UUID;
    v_raw_content_id UUID;
    v_item_created BOOLEAN;
    v_content_changed BOOLEAN;
BEGIN
    INSERT INTO integration_connections (user_id, provider_id, collection_mode, status, connected_at, last_verified_at)
    VALUES (p_user_id, p_provider_id, p_collection_mode, 'connected', NOW(), NOW())
    ON CONFLICT (user_id, provider_id) DO UPDATE SET
        collection_mode = EXCLUDED.collection_mode,
        status = 'connected',
        last_verified_at = NOW(),
        disconnected_at = NULL
    RETURNING id INTO v_connection_id;

    INSERT INTO source_payloads (
        connection_id, sync_run_id, provider_object_type, provider_object_id, payload,
        payload_hash, provider_created_at, provider_updated_at, parser_version
    ) VALUES (
        v_connection_id, p_sync_run_id, p_provider_object_type, p_provider_object_id, p_payload,
        p_payload_hash, p_provider_created_at, p_provider_updated_at, p_parser_version
    )
    ON CONFLICT (connection_id, provider_object_type, provider_object_id, payload_hash)
    DO UPDATE SET payload_hash = EXCLUDED.payload_hash
    RETURNING id INTO v_payload_id;

    SELECT id, latest_payload_id INTO v_existing_item_id, v_previous_payload_id
    FROM source_items
    WHERE connection_id = v_connection_id
      AND provider_object_type = p_provider_object_type
      AND provider_object_id = p_provider_object_id;

    v_item_created := v_existing_item_id IS NULL;
    v_content_changed := v_item_created OR v_previous_payload_id IS DISTINCT FROM v_payload_id;

    INSERT INTO source_items (
        user_id, connection_id, latest_payload_id, provider_object_type, provider_object_id,
        canonical_type, canonical_text, analysis_eligible, normalized_data, occurred_at, provider_created_at,
        provider_updated_at, normalizer_version, deleted_at
    ) VALUES (
        p_user_id, v_connection_id, v_payload_id, p_provider_object_type, p_provider_object_id,
        p_canonical_type, p_canonical_text, p_analysis_eligible, p_normalized_data, p_occurred_at, p_provider_created_at,
        p_provider_updated_at, p_normalizer_version, NULL
    )
    ON CONFLICT (connection_id, provider_object_type, provider_object_id) DO UPDATE SET
        latest_payload_id = EXCLUDED.latest_payload_id,
        canonical_type = EXCLUDED.canonical_type,
        canonical_text = EXCLUDED.canonical_text,
        analysis_eligible = EXCLUDED.analysis_eligible,
        normalized_data = EXCLUDED.normalized_data,
        occurred_at = EXCLUDED.occurred_at,
        provider_created_at = EXCLUDED.provider_created_at,
        provider_updated_at = EXCLUDED.provider_updated_at,
        normalizer_version = EXCLUDED.normalizer_version,
        deleted_at = NULL
    RETURNING id INTO v_source_item_id;

    INSERT INTO analysis_units (
        user_id, source_item_id, unit_type, content, structured_data, occurred_at, sequence_index, analyzer_version
    ) VALUES (
        p_user_id, v_source_item_id, p_canonical_type, p_canonical_text, p_normalized_data, p_occurred_at, 0, p_normalizer_version
    )
    ON CONFLICT (source_item_id, unit_type, sequence_index, analyzer_version) DO UPDATE SET
        content = EXCLUDED.content,
        structured_data = EXCLUDED.structured_data,
        occurred_at = EXCLUDED.occurred_at;

    IF p_analysis_eligible THEN
        INSERT INTO raw_content (
            user_id, content_type, content, content_date, metadata, processing_status, source_item_id
        ) VALUES (
            p_user_id, p_content_type, p_canonical_text, p_occurred_at,
            p_metadata || jsonb_build_object(
                'provider_id', p_provider_id,
                'provider_object_type', p_provider_object_type,
                'provider_object_id', p_provider_object_id,
                'source_payload_id', v_payload_id,
                'source_item_id', v_source_item_id,
                'normalizer_version', p_normalizer_version
            ),
            'pending', v_source_item_id
        )
        ON CONFLICT (source_item_id) WHERE source_item_id IS NOT NULL DO UPDATE SET
            content_type = EXCLUDED.content_type,
            content = EXCLUDED.content,
            content_date = EXCLUDED.content_date,
            metadata = EXCLUDED.metadata,
            processing_status = CASE WHEN v_content_changed THEN 'pending' ELSE raw_content.processing_status END,
            processing_error = CASE WHEN v_content_changed THEN NULL ELSE raw_content.processing_error END,
            processing_started_at = CASE WHEN v_content_changed THEN NULL ELSE raw_content.processing_started_at END,
            processed_at = CASE WHEN v_content_changed THEN NULL ELSE raw_content.processed_at END
        RETURNING id INTO v_raw_content_id;
    END IF;

    RETURN QUERY SELECT v_source_item_id, v_raw_content_id, v_item_created, v_content_changed;
END;
$$;
