-- 140: citing retired evidence again counts as the answer moving (review finding 10).
--
-- Migration 138 revives retired evidence when a re-derivation cites it again,
-- but ON CONFLICT ... RETURNING (xmax = 0) is false for a revived row, so the
-- answer's last_moved_at stayed put although its support changed. Identical to
-- 138's record_answer apart from noting a revival before the insert.

CREATE OR REPLACE FUNCTION record_answer(p JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user      UUID := (p->>'user_id')::UUID;
    v_question  canonical_questions%ROWTYPE;
    v_evidence  JSONB := COALESCE(p->'evidence', '[]'::JSONB);
    v_answer    UUID;
    v_entry     JSONB;
    v_kind      TEXT;
    v_key       TEXT;
    v_at        TIMESTAMPTZ;
    v_ids       UUID[] := '{}';
    v_new_id    UUID;
    v_changed   BOOLEAN := FALSE;
    v_n         INTEGER;
    v_inserted  BOOLEAN;
    v_revived   BOOLEAN;
BEGIN
    IF v_user IS NULL OR COALESCE(p->>'derivation_key', '') = '' THEN
        RAISE EXCEPTION 'record_answer: user_id and derivation_key are required' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_question FROM canonical_questions WHERE id = (p->>'question_id')::SMALLINT;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'record_answer: unknown question %', p->>'question_id' USING ERRCODE = '22023';
    END IF;
    IF v_question.hypothesis_only AND p->>'derived_by' IS DISTINCT FROM 'hypothesis' THEN
        RAISE EXCEPTION 'record_answer: question % can only be answered as a hypothesis (goal 21)', v_question.id
            USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(v_evidence) <> 'array'
       OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_evidence) e
                      WHERE COALESCE(e->>'stance', 'supports') = 'supports') THEN
        RAISE EXCEPTION 'record_answer: an answer needs at least one piece of supporting evidence'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO question_answers AS a (user_id, question_id, answer, detail, derived_by, derivation_key, model_version)
    VALUES (v_user, v_question.id, p->>'answer', COALESCE(p->'detail', '{}'::JSONB), p->>'derived_by',
            p->>'derivation_key', p->>'model_version')
    ON CONFLICT (user_id, derivation_key) DO UPDATE SET
        question_id   = EXCLUDED.question_id,
        answer        = EXCLUDED.answer,
        detail        = EXCLUDED.detail,
        derived_by    = EXCLUDED.derived_by,
        model_version = EXCLUDED.model_version,
        status        = 'active',
        retired_at    = NULL,
        retirement_reason = NULL,
        updated_at    = NOW()
    RETURNING a.id, (xmax = 0) INTO v_answer, v_changed;

    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_evidence) LOOP
        IF num_nonnulls(v_entry->>'assertion_id', v_entry->>'pattern_id', v_entry->>'raw_content_id') <> 1 THEN
            RAISE EXCEPTION 'record_answer: each evidence item cites exactly one fact, pattern or stored item'
                USING ERRCODE = '22023';
        END IF;

        v_kind := NULL; v_key := NULL; v_at := NULL;

        IF v_entry ? 'raw_content_id' AND v_entry->>'raw_content_id' IS NOT NULL THEN
            SELECT evidence_kind_for_trust(r.content_type, r.authorship, r.trust_class),
                   COALESCE(r.dedup_key, md5(r.content)),
                   COALESCE(r.content_date, r.created_at)
              INTO v_kind, v_key, v_at
              FROM raw_content r
             WHERE r.id = (v_entry->>'raw_content_id')::UUID AND r.user_id = v_user;
        ELSIF v_entry ? 'assertion_id' AND v_entry->>'assertion_id' IS NOT NULL THEN
            -- A fact is the kind of the item it was read from, and copies of
            -- that item are one source. A fact with no stored item behind it
            -- (an integration record) is a 'record' and counts by itself.
            SELECT COALESCE(evidence_kind_for_trust(r.content_type, r.authorship, r.trust_class), 'record'),
                   COALESCE(r.dedup_key, md5(r.content), 'assertion:' || s.id::TEXT),
                   COALESCE(s.event_time, s.observed_at)
              INTO v_kind, v_key, v_at
              FROM assertions s
              LEFT JOIN LATERAL (
                  SELECT rc.* FROM assertion_evidence ae
                  JOIN raw_content rc ON rc.id = ae.raw_content_id
                  WHERE ae.assertion_id = s.id AND ae.evidence_role = 'supports'
                  ORDER BY rc.created_at LIMIT 1
              ) r ON TRUE
             WHERE s.id = (v_entry->>'assertion_id')::UUID AND s.user_id = v_user AND s.status = 'active';
        ELSE
            SELECT 'pattern', 'pattern:' || b.id::TEXT, COALESCE(b.last_seen_at, b.updated_at, b.created_at)
              INTO v_kind, v_key, v_at
              FROM behavior_patterns b
             WHERE b.id = (v_entry->>'pattern_id')::UUID AND b.user_id = v_user AND b.status = 'live';
        END IF;

        IF v_kind IS NULL THEN
            RAISE EXCEPTION 'record_answer: evidence % is not this person''s, or is not live', v_entry
                USING ERRCODE = '42501';
        END IF;
        IF v_entry ? 'kind' AND v_entry->>'kind' IS DISTINCT FROM v_kind THEN
            RAISE EXCEPTION 'record_answer: evidence labelled % is actually %', v_entry->>'kind', v_kind
                USING ERRCODE = '23514';
        END IF;

        -- Citing retired evidence again changes the answer's support (review finding 10).
        SELECT TRUE INTO v_revived FROM answer_evidence e
         WHERE e.answer_id = v_answer AND e.stance = COALESCE(v_entry->>'stance', 'supports')
           AND e.assertion_id IS NOT DISTINCT FROM (v_entry->>'assertion_id')::UUID
           AND e.pattern_id IS NOT DISTINCT FROM (v_entry->>'pattern_id')::UUID
           AND e.raw_content_id IS NOT DISTINCT FROM (v_entry->>'raw_content_id')::UUID
           AND e.retired_at IS NOT NULL;

        INSERT INTO answer_evidence AS ev (user_id, answer_id, stance, assertion_id, pattern_id, raw_content_id,
                                           kind_id, source_key, observed_at, excerpt)
        VALUES (v_user, v_answer, COALESCE(v_entry->>'stance', 'supports'),
                (v_entry->>'assertion_id')::UUID, (v_entry->>'pattern_id')::UUID, (v_entry->>'raw_content_id')::UUID,
                v_kind, v_key, v_at, v_entry->>'excerpt')
        ON CONFLICT (answer_id, stance, assertion_id, pattern_id, raw_content_id) DO UPDATE SET
            excerpt = EXCLUDED.excerpt,
            -- Cited again: it counts again.
            retired_at = NULL
        RETURNING ev.id, (xmax = 0) INTO v_new_id, v_inserted;
        v_ids := v_ids || v_new_id;
        v_changed := v_changed OR v_inserted OR COALESCE(v_revived, FALSE);
    END LOOP;

    -- Evidence the new derivation no longer cites is RETIRED, never deleted
    -- (F1.4, invalidate-never-delete), so "why was this once believed?" keeps
    -- its answer. Done only after the new set is in, so the answer is never
    -- momentarily unsupported.
    UPDATE answer_evidence SET retired_at = NOW()
     WHERE answer_id = v_answer AND NOT (id = ANY (v_ids)) AND retired_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_changed := v_changed OR v_n > 0;

    IF NOT answer_is_supported(v_answer) THEN
        RAISE EXCEPTION 'record_answer: question % needs the person''s own words, and none of this evidence is',
            v_question.id USING ERRCODE = '23514';
    END IF;

    IF v_changed THEN
        UPDATE question_answers SET last_moved_at = NOW() WHERE id = v_answer;
    END IF;
    RETURN v_answer;
END;
$$;



REVOKE ALL ON FUNCTION record_answer(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_answer(JSONB) TO service_role;
