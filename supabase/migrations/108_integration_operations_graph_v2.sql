-- Production integration operations, encrypted credentials, archive imports,
-- and the second-generation evidence-weighted personal knowledge graph.

ALTER TABLE integration_jobs DROP CONSTRAINT IF EXISTS integration_jobs_job_type_check;
ALTER TABLE integration_jobs DROP CONSTRAINT IF EXISTS integration_jobs_status_check;
ALTER TABLE integration_jobs
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT DEFAULT uuid_generate_v4()::TEXT,
    ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
    ADD CONSTRAINT integration_jobs_job_type_check CHECK (
        job_type IN (
            'initial_backfill', 'incremental_sync', 'webhook_recovery', 'replay',
            'export_import', 'device_batch', 'oauth_sync', 'archive_parse',
            'reconcile', 'delete_connection_data'
        )
    ),
    ADD CONSTRAINT integration_jobs_status_check CHECK (
        status IN ('queued', 'leased', 'running', 'completed', 'failed', 'dead_letter', 'cancelled')
    );

UPDATE integration_jobs SET idempotency_key = id::TEXT WHERE idempotency_key IS NULL;
UPDATE integration_jobs j
SET user_id = c.user_id
FROM integration_connections c
WHERE j.connection_id = c.id AND j.user_id IS NULL;

ALTER TABLE integration_jobs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE integration_jobs ALTER COLUMN idempotency_key SET NOT NULL;
ALTER TABLE integration_jobs DROP CONSTRAINT IF EXISTS integration_jobs_connection_id_idempotency_key_key;
ALTER TABLE integration_jobs ADD CONSTRAINT integration_jobs_connection_id_idempotency_key_key
    UNIQUE (connection_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_integration_jobs_lease
    ON integration_jobs(priority, available_at, created_at)
    WHERE status IN ('queued', 'leased');

CREATE TABLE IF NOT EXISTS integration_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL UNIQUE REFERENCES integration_connections(id) ON DELETE CASCADE,
    encryption_scheme TEXT NOT NULL DEFAULT 'aes-256-gcm-envelope-v1',
    encrypted_credentials TEXT NOT NULL,
    encrypted_data_key TEXT,
    key_id TEXT,
    credential_version INTEGER NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ,
    refresh_after TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    content_type TEXT,
    byte_size BIGINT,
    sha256 TEXT,
    parser_version TEXT,
    status TEXT NOT NULL DEFAULT 'awaiting_upload'
        CHECK (status IN ('awaiting_upload', 'uploaded', 'queued', 'processing', 'completed', 'failed', 'deleted')),
    error_message TEXT,
    items_imported INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uploaded_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    UNIQUE (connection_id, sha256)
);

CREATE TABLE IF NOT EXISTS source_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    source_item_id UUID REFERENCES source_items(id) ON DELETE CASCADE,
    provider_object_type TEXT NOT NULL,
    provider_object_id TEXT NOT NULL,
    asset_role TEXT NOT NULL,
    storage_bucket TEXT NOT NULL DEFAULT 'integration-media',
    storage_path TEXT NOT NULL,
    content_type TEXT,
    byte_size BIGINT,
    sha256 TEXT,
    encryption_metadata JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'awaiting_upload'
        CHECK (status IN ('awaiting_upload', 'uploaded', 'verified', 'quarantined', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uploaded_at TIMESTAMPTZ,
    UNIQUE (connection_id, provider_object_type, provider_object_id, asset_role, sha256)
);

CREATE TABLE IF NOT EXISTS integration_audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES integration_connections(id) ON DELETE SET NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'worker', 'admin')),
    actor_id TEXT,
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_oauth_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    state_hash TEXT NOT NULL UNIQUE,
    code_verifier TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_audit_user_time
    ON integration_audit_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (
        entity_type IN ('person', 'organization', 'project', 'place', 'topic', 'event', 'goal', 'identity', 'emotion', 'habit')
    ),
    canonical_name TEXT NOT NULL,
    description TEXT,
    attributes JSONB NOT NULL DEFAULT '{}',
    confidence NUMERIC(4, 3) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'retired')),
    merged_into_id UUID REFERENCES entities(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entities_user_type_name
    ON entities(user_id, entity_type, lower(canonical_name));

CREATE TABLE IF NOT EXISTS entity_aliases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    namespace TEXT NOT NULL,
    alias TEXT NOT NULL,
    source_item_id UUID REFERENCES source_items(id) ON DELETE SET NULL,
    confidence NUMERIC(4, 3) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, namespace, alias)
);

CREATE TABLE IF NOT EXISTS entity_resolution_candidates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    left_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    right_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    signals JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
    resolver_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CHECK (left_entity_id <> right_entity_id),
    UNIQUE (left_entity_id, right_entity_id)
);

CREATE TABLE IF NOT EXISTS assertions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    predicate TEXT NOT NULL,
    object_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
    object_value JSONB,
    assertion_kind TEXT NOT NULL CHECK (
        assertion_kind IN ('observed', 'inferred', 'user_confirmed', 'contradicted', 'superseded')
    ),
    confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    event_time TIMESTAMPTZ,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_from TIMESTAMPTZ,
    valid_to TIMESTAMPTZ,
    model_version TEXT,
    normalizer_version TEXT,
    supersedes_id UUID REFERENCES assertions(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'contradicted', 'superseded', 'retired')),
    metadata JSONB NOT NULL DEFAULT '{}',
    origin_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (object_entity_id IS NOT NULL OR object_value IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_assertions_subject_predicate
    ON assertions(user_id, subject_entity_id, predicate, event_time DESC);
ALTER TABLE assertions DROP CONSTRAINT IF EXISTS assertions_user_id_origin_key_key;
ALTER TABLE assertions ADD CONSTRAINT assertions_user_id_origin_key_key UNIQUE (user_id, origin_key);

CREATE TABLE IF NOT EXISTS assertion_evidence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assertion_id UUID NOT NULL REFERENCES assertions(id) ON DELETE CASCADE,
    analysis_unit_id UUID REFERENCES analysis_units(id) ON DELETE CASCADE,
    source_item_id UUID REFERENCES source_items(id) ON DELETE CASCADE,
    raw_content_id UUID REFERENCES raw_content(id) ON DELETE CASCADE,
    evidence_role TEXT NOT NULL CHECK (evidence_role IN ('supports', 'contradicts', 'context')),
    weight NUMERIC(4, 3) NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 1),
    excerpt TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (analysis_unit_id IS NOT NULL OR source_item_id IS NOT NULL OR raw_content_id IS NOT NULL),
    UNIQUE NULLS NOT DISTINCT (assertion_id, analysis_unit_id, source_item_id, raw_content_id, evidence_role)
);

CREATE TABLE IF NOT EXISTS assertion_relations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_assertion_id UUID NOT NULL REFERENCES assertions(id) ON DELETE CASCADE,
    to_assertion_id UUID NOT NULL REFERENCES assertions(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK (
        relation_type IN ('supports', 'contradicts', 'supersedes', 'refines', 'caused_by', 'co_occurs_with')
    ),
    confidence NUMERIC(4, 3) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
    model_version TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (from_assertion_id <> to_assertion_id),
    UNIQUE (from_assertion_id, to_assertion_id, relation_type)
);

ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_resolution_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assertion_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE assertion_relations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
    policy_name TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'integration_credentials', 'integration_imports', 'source_assets', 'integration_audit_events',
        'entities', 'entity_aliases', 'entity_resolution_candidates', 'assertions', 'assertion_evidence', 'assertion_relations'
    ] LOOP
        policy_name := format('Users can view own %s', t);
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = t
              AND policyname = policy_name
        ) THEN
            EXECUTE format(
                'CREATE POLICY %I ON %I FOR SELECT USING (user_id = auth.uid())',
                policy_name,
                t
            );
        END IF;
    END LOOP;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'integration_sync_states' AND policyname = 'Users can view own integration sync states') THEN
        CREATE POLICY "Users can view own integration sync states" ON integration_sync_states FOR SELECT
        USING (EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'integration_jobs' AND policyname = 'Users can view own integration jobs') THEN
        CREATE POLICY "Users can view own integration jobs" ON integration_jobs FOR SELECT USING (user_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'integration_sync_runs' AND policyname = 'Users can view own integration sync runs') THEN
        CREATE POLICY "Users can view own integration sync runs" ON integration_sync_runs FOR SELECT
        USING (EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = auth.uid()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'source_payloads' AND policyname = 'Users can view own source payloads') THEN
        CREATE POLICY "Users can view own source payloads" ON source_payloads FOR SELECT
        USING (EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = auth.uid()));
    END IF;
END $$;

DROP TRIGGER IF EXISTS update_integration_credentials_updated_at ON integration_credentials;
CREATE TRIGGER update_integration_credentials_updated_at
    BEFORE UPDATE ON integration_credentials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_entities_updated_at ON entities;
CREATE TRIGGER update_entities_updated_at
    BEFORE UPDATE ON entities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_assertions_updated_at ON assertions;
CREATE TRIGGER update_assertions_updated_at
    BEFORE UPDATE ON assertions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION lease_integration_jobs(
    p_worker_id TEXT,
    p_limit INTEGER DEFAULT 5,
    p_lease_seconds INTEGER DEFAULT 300
)
RETURNS SETOF integration_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT id
        FROM integration_jobs
        WHERE (
            status = 'queued'
            OR (status = 'leased' AND leased_until < NOW())
        )
          AND available_at <= NOW()
          AND attempt_count < max_attempts
        ORDER BY priority ASC, available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, LEAST(p_limit, 50))
    )
    UPDATE integration_jobs j
    SET status = 'leased',
        lease_owner = p_worker_id,
        leased_until = NOW() + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1,
        updated_at = NOW()
    FROM candidates
    WHERE j.id = candidates.id
    RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION fail_integration_job(
    p_job_id UUID,
    p_worker_id TEXT,
    p_error TEXT,
    p_retry_delay_seconds INTEGER DEFAULT 60
)
RETURNS integration_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result integration_jobs;
BEGIN
    UPDATE integration_jobs
    SET status = CASE WHEN attempt_count >= max_attempts THEN 'dead_letter' ELSE 'queued' END,
        available_at = CASE WHEN attempt_count >= max_attempts THEN available_at ELSE NOW() + make_interval(secs => p_retry_delay_seconds) END,
        dead_lettered_at = CASE WHEN attempt_count >= max_attempts THEN NOW() ELSE NULL END,
        last_error_at = NOW(),
        error_message = left(p_error, 4000),
        lease_owner = NULL,
        leased_until = NULL,
        updated_at = NOW()
    WHERE id = p_job_id AND lease_owner = p_worker_id
    RETURNING * INTO result;
    RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION complete_integration_job(p_job_id UUID, p_worker_id TEXT)
RETURNS integration_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result integration_jobs;
BEGIN
    UPDATE integration_jobs
    SET status = 'completed',
        completed_at = NOW(),
        lease_owner = NULL,
        leased_until = NULL,
        error_message = NULL,
        updated_at = NOW()
    WHERE id = p_job_id AND lease_owner = p_worker_id
    RETURNING * INTO result;
    RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION heartbeat_integration_job(
    p_job_id UUID,
    p_worker_id TEXT,
    p_lease_seconds INTEGER DEFAULT 300
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    touched INTEGER;
BEGIN
    UPDATE integration_jobs
    SET leased_until = NOW() + make_interval(secs => p_lease_seconds),
        updated_at = NOW()
    WHERE id = p_job_id
      AND lease_owner = p_worker_id
      AND status = 'leased';
    GET DIAGNOSTICS touched = ROW_COUNT;
    RETURN touched = 1;
END;
$$;

REVOKE ALL ON FUNCTION lease_integration_jobs(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_integration_job(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_integration_job(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION heartbeat_integration_job(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lease_integration_jobs(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION fail_integration_job(UUID, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION complete_integration_job(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION heartbeat_integration_job(UUID, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION delete_integration_connection_data(p_user_id UUID, p_connection_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM integration_connections WHERE id = p_connection_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'integration connection not found';
    END IF;

    INSERT INTO integration_audit_events (user_id, connection_id, actor_type, event_type, event_data)
    VALUES (p_user_id, p_connection_id, 'worker', 'connection_data_deleted', '{}');

    DELETE FROM entity_aliases
    WHERE user_id = p_user_id
      AND source_item_id IN (SELECT id FROM source_items WHERE connection_id = p_connection_id);
    DELETE FROM raw_content
    WHERE user_id = p_user_id
      AND source_item_id IN (SELECT id FROM source_items WHERE connection_id = p_connection_id);
    DELETE FROM integration_connections WHERE id = p_connection_id AND user_id = p_user_id;
    DELETE FROM assertions a
    WHERE a.user_id = p_user_id
      AND a.assertion_kind <> 'user_confirmed'
      AND NOT EXISTS (
          SELECT 1 FROM assertion_evidence ae WHERE ae.assertion_id = a.id
      );
    DELETE FROM entities e
    WHERE e.user_id = p_user_id
      AND e.entity_type <> 'identity'
      AND NOT EXISTS (SELECT 1 FROM entity_aliases ea WHERE ea.entity_id = e.id)
      AND NOT EXISTS (
          SELECT 1 FROM assertions a
          WHERE a.subject_entity_id = e.id OR a.object_entity_id = e.id
      );
END;
$$;

REVOKE ALL ON FUNCTION delete_integration_connection_data(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_integration_connection_data(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION resolve_entity_candidate(
    p_user_id UUID,
    p_candidate_id UUID,
    p_decision TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_left UUID;
    v_right UUID;
BEGIN
    IF p_decision NOT IN ('accepted', 'rejected') THEN
        RAISE EXCEPTION 'invalid entity resolution decision';
    END IF;

    SELECT left_entity_id, right_entity_id INTO v_left, v_right
    FROM entity_resolution_candidates
    WHERE id = p_candidate_id AND user_id = p_user_id AND status = 'pending'
    FOR UPDATE;
    IF v_left IS NULL OR v_right IS NULL THEN
        RAISE EXCEPTION 'entity resolution candidate not found';
    END IF;

    IF p_decision = 'accepted' THEN
        DELETE FROM entity_aliases right_alias
        USING entity_aliases left_alias
        WHERE right_alias.user_id = p_user_id
          AND right_alias.entity_id = v_right
          AND left_alias.user_id = p_user_id
          AND left_alias.entity_id = v_left
          AND left_alias.namespace = right_alias.namespace
          AND left_alias.alias = right_alias.alias;
        UPDATE entity_aliases SET entity_id = v_left WHERE user_id = p_user_id AND entity_id = v_right;
        UPDATE assertions SET subject_entity_id = v_left WHERE user_id = p_user_id AND subject_entity_id = v_right;
        UPDATE assertions SET object_entity_id = v_left WHERE user_id = p_user_id AND object_entity_id = v_right;
        UPDATE entities SET status = 'merged', merged_into_id = v_left WHERE user_id = p_user_id AND id = v_right;
    END IF;

    UPDATE entity_resolution_candidates
    SET status = p_decision, resolved_at = NOW()
    WHERE id = p_candidate_id AND user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION resolve_entity_candidate(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_entity_candidate(UUID, UUID, TEXT) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
    ('integration-imports', 'integration-imports', FALSE, 1073741824),
    ('integration-evidence', 'integration-evidence', FALSE, 1073741824),
    ('integration-media', 'integration-media', FALSE, 5368709120)
ON CONFLICT (id) DO UPDATE SET public = FALSE;
