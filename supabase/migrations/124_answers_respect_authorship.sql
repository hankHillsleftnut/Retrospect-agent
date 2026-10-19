-- 124: a document in your Drive is not automatically your words.
--
-- Found on 18 October 2026, reading the founder's writing to build the test
-- bank: among their "documents" were a hiring post by someone else ("My name
-- is Farza..."), a company's design brief addressed to them ("Thank you for
-- taking the time to engage with this design exercise"), and a third party's
-- negotiation resources. Migration 121 mapped every Google Doc to the
-- 'document' kind, which counts as the person's own words -- so the first
-- pass saved one answer (Q26) citing the company's brief as if they had
-- written it.
--
-- Migration 115 already records whose words each item is: 'self', 'other' or
-- 'unknown' (every Google Doc is 'unknown' -- there is no way to tell from the
-- file). This makes the answer store honour it:
--
--   * Own-words kinds (journal, document, ...) count as own words only when
--     the item is authorship 'self'. Otherwise they become 'collected_document':
--     still evidence -- it shows what is in their life -- but not their voice,
--     so it can never on its own answer a question that needs their words.
--   * Evidence already saved is relabelled, and any answer left without the
--     support its question needs is retired, with the reason. Nothing deleted.

-- Normally added by 115. Repeated (without its CHECK) so this migration stands
-- alone on a database built from a branch that does not have 115 yet. A no-op
-- in production.
ALTER TABLE raw_content ADD COLUMN IF NOT EXISTS authorship TEXT;

INSERT INTO evidence_kinds (id, label, weight, own_words) VALUES
    ('collected_document', 'A document they have, author unknown', 0.30, FALSE)
ON CONFLICT (id) DO NOTHING;

-- The kind of a stored item, from its type AND whose words it is. A NULL
-- authorship (a database without 115) keeps 121's behaviour.
CREATE OR REPLACE FUNCTION evidence_kind_for(p_content_type TEXT, p_authorship TEXT)
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT CASE
        WHEN p_authorship IN ('other', 'unknown')
             AND (SELECT own_words FROM evidence_kinds WHERE id = evidence_kind_for_content_type(p_content_type))
        THEN 'collected_document'
        ELSE evidence_kind_for_content_type(p_content_type)
    END
$$;

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
            SELECT evidence_kind_for(r.content_type, r.authorship),
                   COALESCE(r.dedup_key, md5(r.content)),
                   COALESCE(r.content_date, r.created_at)
              INTO v_kind, v_key, v_at
              FROM raw_content r
             WHERE r.id = (v_entry->>'raw_content_id')::UUID AND r.user_id = v_user;
        ELSIF v_entry ? 'assertion_id' AND v_entry->>'assertion_id' IS NOT NULL THEN
            -- A fact is the kind of the item it was read from, and copies of
            -- that item are one source. A fact with no stored item behind it
            -- (an integration record) is a 'record' and counts by itself.
            SELECT COALESCE(evidence_kind_for(r.content_type, r.authorship), 'record'),
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
            excerpt = EXCLUDED.excerpt
        RETURNING ev.id, (xmax = 0) INTO v_new_id, v_inserted;
        v_ids := v_ids || v_new_id;
        v_changed := v_changed OR v_inserted;
    END LOOP;

    -- Evidence the new derivation no longer cites. Removed only after the new
    -- set is in, so the answer is never momentarily unsupported.
    DELETE FROM answer_evidence WHERE answer_id = v_answer AND NOT (id = ANY (v_ids));
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
CREATE OR REPLACE FUNCTION record_answer_verdict(p_user UUID, p_answer UUID, p_verdict TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE question_answers
       SET user_verdict = p_verdict, verdict_at = NOW(), updated_at = NOW()
     WHERE id = p_answer AND user_id = p_user;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'record_answer_verdict: no such answer for this person' USING ERRCODE = '42501';
    END IF;
END;
$$;


REVOKE ALL ON FUNCTION record_answer(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_answer(JSONB) TO service_role;

-- Relabel what is already saved. Evidence citing a stored item directly:
UPDATE answer_evidence e
   SET kind_id = evidence_kind_for(r.content_type, r.authorship)
  FROM raw_content r
 WHERE e.raw_content_id = r.id
   AND e.kind_id IS DISTINCT FROM evidence_kind_for(r.content_type, r.authorship);

-- An answer whose question needs their own words, left with none, retires.
UPDATE question_answers a
   SET status = 'retired', retired_at = NOW(), updated_at = NOW(),
       retirement_reason = 'Its only support was a document not written by them (migration 124).'
 WHERE a.status = 'active'
   AND NOT answer_is_supported(a.id);
