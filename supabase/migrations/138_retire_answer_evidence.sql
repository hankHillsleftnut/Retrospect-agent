-- 138: re-deriving an answer retires the evidence it no longer cites (F1.4b).
--
-- Until now record_answer DELETED evidence a new derivation stopped citing, so
-- the history of why an answer was once believed was lost: the one known
-- break of "invalidate, never delete" (tests/never-delete.test.ts). Approved
-- by the founder, 19 Oct. Now the row stays, with retired_at set, and comes
-- back if it's cited again. Everything that measures an answer's CURRENT
-- support ignores retired rows: the support check, the confidence view and the
-- lineage view. History (W4.2, "what moved") can still see them.

ALTER TABLE answer_evidence ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION answer_is_supported(p_answer UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM answer_evidence e
        JOIN evidence_kinds k ON k.id = e.kind_id
        JOIN question_answers a ON a.id = e.answer_id
        JOIN canonical_questions q ON q.id = a.question_id
        WHERE e.answer_id = p_answer
          AND e.stance = 'supports'
          AND e.retired_at IS NULL
          AND (NOT q.requires_own_words OR k.own_words)
    )
$$;


CREATE OR REPLACE VIEW answer_confidence WITH (security_invoker = true) AS
WITH per_source AS (
    -- One vote per independent source and stance: the strongest of its copies.
    SELECT e.answer_id, e.stance, e.source_key,
           max(k.weight * power(0.5, extract(epoch FROM (NOW() - e.observed_at)) / 86400.0
                                     / COALESCE(q.half_life_days, d.half_life_days))) AS vote
    FROM answer_evidence e
    JOIN evidence_kinds k ON k.id = e.kind_id
    JOIN question_answers a ON a.id = e.answer_id
    JOIN canonical_questions q ON q.id = a.question_id
    JOIN question_domains d ON d.id = q.domain_id
    WHERE e.retired_at IS NULL
    GROUP BY e.answer_id, e.stance, e.source_key
)
SELECT a.id AS answer_id, a.user_id, a.question_id, a.status, a.user_verdict,
       COALESCE(sum(ps.vote) FILTER (WHERE ps.stance = 'supports'), 0)    AS support,
       COALESCE(sum(ps.vote) FILTER (WHERE ps.stance = 'contradicts'), 0) AS against,
       COALESCE(sum(ps.vote) FILTER (WHERE ps.stance = 'supports'), 0)
         / (COALESCE(sum(ps.vote), 0) + 2)                                AS confidence,
       count(*) FILTER (WHERE ps.stance = 'supports')                     AS independent_sources
FROM question_answers a
LEFT JOIN per_source ps ON ps.answer_id = a.id
GROUP BY a.id;


CREATE OR REPLACE VIEW claim_edges WITH (security_invoker = true) AS
    SELECT e.user_id, 'fact'::text AS claim_kind, e.assertion_id AS claim_id,
           CASE WHEN e.raw_content_id IS NOT NULL THEN 'raw_content' ELSE 'source_item' END AS evidence_kind,
           COALESCE(e.raw_content_id, e.source_item_id) AS evidence_id,
           e.evidence_role AS role, e.excerpt
      FROM assertion_evidence e
     WHERE e.raw_content_id IS NOT NULL OR e.source_item_id IS NOT NULL
    UNION ALL
    SELECT f.user_id, 'pattern', f.pattern_id, 'fact', f.assertion_id, f.role, NULL
      FROM behavior_pattern_facts f
    UNION ALL
    SELECT w.user_id, 'why', w.id, 'pattern', w.pattern_id, 'explains', NULL
      FROM behavior_pattern_whys w
    UNION ALL
    SELECT w.user_id, 'why', w.id, 'fact', a.assertion_id, 'supports', NULL
      FROM behavior_pattern_whys w, unnest(w.evidence_assertion_ids) AS a(assertion_id)
    UNION ALL
    SELECT ae.user_id, 'answer', ae.answer_id,
           CASE WHEN ae.assertion_id IS NOT NULL THEN 'fact'
                WHEN ae.pattern_id IS NOT NULL THEN 'pattern'
                ELSE 'raw_content' END,
           COALESCE(ae.assertion_id, ae.pattern_id, ae.raw_content_id),
           ae.stance, ae.excerpt
      FROM answer_evidence ae
     WHERE ae.retired_at IS NULL;

-- Service only: the app's roles never read lineage directly.

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
        v_changed := v_changed OR v_inserted;
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
