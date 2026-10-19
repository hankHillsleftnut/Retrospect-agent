-- 119: save a fact and its evidence together, or not at all.
--
-- writeFact used to make two separate calls: save the fact, then save its
-- evidence. If the second failed, the fact stood with nothing behind it -- a
-- claim the product could not back up. This function does both inside one
-- transaction, so a failure anywhere leaves no trace.
--
-- It is the foundation the question store (Phase 2) builds on: an answer can
-- only be as trustworthy as the facts it cites.
--
-- Behaviour matches the old two-call path exactly, apart from atomicity:
--   * Upsert on (user_id, origin_key). A re-save overwrites the fact's content
--     but never observed_at (when it was first seen) or status (whether it has
--     since been superseded).
--   * model_version and source_run_id are only overwritten when supplied, so a
--     later writer that doesn't know them cannot null them.
--   * Evidence upserts on its existing unique rule (NULLS NOT DISTINCT, so a
--     replayed journal entry, which has no source item, does not duplicate).
--
-- Two guards the old path did not have:
--   * No evidence, no fact. Raised here, inside the transaction.
--   * Evidence must belong to the same person as the fact. Nothing writes
--     cross-user evidence today; this makes it impossible rather than unlikely.
--
-- Callers fall back to the old path if this function is absent, so the code can
-- ship before or after this migration is applied.

CREATE OR REPLACE FUNCTION write_fact(p JSONB)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_user_id     UUID := (p->>'user_id')::UUID;
    v_evidence    JSONB := COALESCE(p->'evidence', '[]'::JSONB);
    v_assertion   UUID;
    v_entry       JSONB;
    v_foreign     INTEGER;
BEGIN
    IF v_user_id IS NULL OR COALESCE(p->>'origin_key', '') = '' THEN
        RAISE EXCEPTION 'write_fact: user_id and origin_key are required'
            USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_evidence) <> 'array' OR jsonb_array_length(v_evidence) = 0 THEN
        RAISE EXCEPTION 'write_fact: a fact needs at least one evidence row (origin_key %)', p->>'origin_key'
            USING ERRCODE = '23514';
    END IF;

    -- Evidence from another person's data is refused outright.
    SELECT count(*) INTO v_foreign
    FROM jsonb_array_elements(v_evidence) e
    WHERE (e->>'raw_content_id' IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM raw_content r WHERE r.id = (e->>'raw_content_id')::UUID AND r.user_id = v_user_id))
       OR (e->>'source_item_id' IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM source_items s WHERE s.id = (e->>'source_item_id')::UUID AND s.user_id = v_user_id));
    IF v_foreign > 0 THEN
        RAISE EXCEPTION 'write_fact: evidence must come from the same user''s data (origin_key %)', p->>'origin_key'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO assertions AS a (
        user_id, subject_entity_id, predicate, object_entity_id, object_value,
        assertion_kind, confidence, event_time, normalizer_version, origin_key,
        metadata, model_version, source_run_id
    ) VALUES (
        v_user_id,
        (p->>'subject_entity_id')::UUID,
        p->>'predicate',
        (p->>'object_entity_id')::UUID,
        CASE WHEN jsonb_typeof(p->'object_value') = 'null' THEN NULL ELSE p->'object_value' END,
        COALESCE(p->>'assertion_kind', 'observed'),
        COALESCE((p->>'confidence')::NUMERIC, 1),
        (p->>'event_time')::TIMESTAMPTZ,
        p->>'normalizer_version',
        p->>'origin_key',
        COALESCE(p->'metadata', '{}'::JSONB),
        p->>'model_version',
        (p->>'source_run_id')::UUID
    )
    ON CONFLICT (user_id, origin_key) DO UPDATE SET
        subject_entity_id  = EXCLUDED.subject_entity_id,
        predicate          = EXCLUDED.predicate,
        object_entity_id   = EXCLUDED.object_entity_id,
        object_value       = EXCLUDED.object_value,
        assertion_kind     = EXCLUDED.assertion_kind,
        confidence         = EXCLUDED.confidence,
        event_time         = EXCLUDED.event_time,
        normalizer_version = EXCLUDED.normalizer_version,
        metadata           = EXCLUDED.metadata,
        model_version      = CASE WHEN p ? 'model_version' THEN EXCLUDED.model_version ELSE a.model_version END,
        source_run_id      = CASE WHEN p ? 'source_run_id' THEN EXCLUDED.source_run_id ELSE a.source_run_id END
    RETURNING a.id INTO v_assertion;

    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_evidence) LOOP
        INSERT INTO assertion_evidence AS ae (
            user_id, assertion_id, analysis_unit_id, source_item_id, raw_content_id,
            evidence_role, weight, excerpt, char_start, char_end
        ) VALUES (
            v_user_id,
            v_assertion,
            (v_entry->>'analysis_unit_id')::UUID,
            (v_entry->>'source_item_id')::UUID,
            (v_entry->>'raw_content_id')::UUID,
            COALESCE(v_entry->>'evidence_role', 'supports'),
            COALESCE((v_entry->>'weight')::NUMERIC, 1),
            v_entry->>'excerpt',
            (v_entry->>'char_start')::INTEGER,
            (v_entry->>'char_end')::INTEGER
        )
        ON CONFLICT (assertion_id, analysis_unit_id, source_item_id, raw_content_id, evidence_role) DO UPDATE SET
            weight     = EXCLUDED.weight,
            excerpt    = EXCLUDED.excerpt,
            char_start = CASE WHEN v_entry ? 'char_start' THEN EXCLUDED.char_start ELSE ae.char_start END,
            char_end   = CASE WHEN v_entry ? 'char_end' THEN EXCLUDED.char_end ELSE ae.char_end END;
    END LOOP;

    RETURN v_assertion;
END;
$$;

-- Functions are callable by everyone by default. Only the backend services
-- (service role) write facts; the app's signed-in and anonymous roles must not.
REVOKE ALL ON FUNCTION write_fact(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION write_fact(JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION write_fact(JSONB) TO service_role;

COMMENT ON FUNCTION write_fact(JSONB) IS
    'Saves a fact and its evidence in one transaction. Refuses a fact with no evidence or with evidence from another user. See migration 119.';
