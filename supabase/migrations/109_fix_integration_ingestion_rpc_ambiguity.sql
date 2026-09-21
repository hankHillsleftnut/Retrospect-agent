-- Fix live RPC ambiguity between RETURNS TABLE output names and table columns.
-- Without variable_conflict use_column, Postgres can read source_item_id in
-- ON CONFLICT clauses as the function output parameter instead of the table column.

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
