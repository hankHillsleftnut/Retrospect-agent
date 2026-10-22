-- ============================================================================
-- 152: corrections write through functions, in one transaction (BEA.1)
--
-- Goal: "not right" works in production, and never half-works.
--
-- Why: applying a correction updated question_answers and answer_evidence
-- directly. Migration 121 deliberately gives service_role SELECT only on those
-- two tables ("no direct writes from anyone, including the backend's service
-- key"), so in production the update failed with 42501 -- after the rejection
-- and the fact and pattern retirements had already been written. Tests ran as
-- a superuser and never saw it.
--
-- Fix, keeping 121's design (every answer write goes through a function):
--   retire_answer           retires one answer (and marks it rejected when the
--                           person rejected it), scoped to its owner
--   retire_answer_evidence  retires answer evidence rows, scoped to their owner
--   apply_correction        the whole correction in one call, so one
--                           transaction: the rejection, every retirement and
--                           every evidence retirement land together or not at all
-- All SECURITY DEFINER with search_path pinned, executable by service_role only.
-- Additive: no table changes, no grants on the tables themselves.
-- ============================================================================

CREATE OR REPLACE FUNCTION retire_answer(
    p_user UUID, p_answer UUID, p_reason TEXT, p_reject BOOLEAN, p_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE question_answers
       SET status = 'retired',
           retired_at = p_at,
           retirement_reason = p_reason,
           user_verdict = CASE WHEN p_reject THEN 'rejected' ELSE user_verdict END,
           verdict_at = CASE WHEN p_reject THEN p_at ELSE verdict_at END,
           updated_at = NOW()
     WHERE id = p_answer AND user_id = p_user;
    -- Another person's answer, or none: nothing changes.
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION retire_answer_evidence(p_user UUID, p_evidence_ids UUID[], p_at TIMESTAMPTZ DEFAULT NOW())
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
    UPDATE answer_evidence
       SET retired_at = p_at
     WHERE id = ANY(p_evidence_ids) AND user_id = p_user AND retired_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- p: { user_id, at, mode: 'wrong' | 'changed', note, target: { kind, id },
--      retire: [{ kind: 'fact'|'pattern'|'why'|'answer', id, rejected }],
--      evidence_ids: [uuid] }
-- "wrong" records the rejection so no later write can bring the claim back
-- (migration 148); "changed" retires as of now but isn't blacklisted.
CREATE OR REPLACE FUNCTION apply_correction(p JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user   UUID        := (p->>'user_id')::UUID;
    v_at     TIMESTAMPTZ := COALESCE((p->>'at')::TIMESTAMPTZ, NOW());
    v_kind   TEXT        := p->'target'->>'kind';
    v_target UUID        := (p->'target'->>'id')::UUID;
    v_key    TEXT;
    r        JSONB;
    v_rej    BOOLEAN;
BEGIN
    IF v_user IS NULL OR v_target IS NULL THEN
        RAISE EXCEPTION 'apply_correction: user_id and target are required' USING ERRCODE = '22023';
    END IF;

    IF COALESCE(p->>'mode', 'wrong') <> 'changed' THEN
        IF v_kind = 'fact' THEN
            SELECT fact_claim_key(predicate, object_entity_id, object_value) INTO v_key
              FROM assertions WHERE id = v_target AND user_id = v_user;
        ELSIF v_kind = 'answer' THEN
            SELECT answer_claim_key(question_id, answer) INTO v_key
              FROM question_answers WHERE id = v_target AND user_id = v_user;
        END IF;
        -- Patterns and whys are already never resurrected by their writers (status user_rejected).
        IF v_key IS NOT NULL THEN
            INSERT INTO claim_rejections (user_id, claim_kind, claim_key, source_id, note)
            VALUES (v_user, v_kind, v_key, v_target, p->>'note')
            ON CONFLICT (user_id, claim_kind, claim_key)
            DO UPDATE SET source_id = EXCLUDED.source_id, note = EXCLUDED.note;
        END IF;
    END IF;

    FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p->'retire', '[]'::JSONB)) LOOP
        v_rej := COALESCE((r->>'rejected')::BOOLEAN, FALSE);
        CASE r->>'kind'
            WHEN 'fact' THEN
                UPDATE assertions SET status = 'retired', valid_to = v_at
                 WHERE id = (r->>'id')::UUID AND user_id = v_user;
            WHEN 'pattern' THEN
                UPDATE behavior_patterns SET status = CASE WHEN v_rej THEN 'user_rejected' ELSE 'retired' END
                 WHERE id = (r->>'id')::UUID AND user_id = v_user;
            WHEN 'why' THEN
                UPDATE behavior_pattern_whys
                   SET status = CASE WHEN v_rej THEN 'user_rejected' ELSE 'retired' END,
                       retired_at = v_at,
                       retirement_reason = CASE WHEN v_rej THEN 'rejected by the person' ELSE 'its support was corrected away' END
                 WHERE id = (r->>'id')::UUID AND user_id = v_user;
            WHEN 'answer' THEN
                PERFORM retire_answer(v_user, (r->>'id')::UUID,
                    CASE WHEN v_rej THEN 'rejected by the person' ELSE 'its support was corrected away' END, v_rej, v_at);
            ELSE
                RAISE EXCEPTION 'apply_correction: unknown claim kind %', r->>'kind' USING ERRCODE = '22023';
        END CASE;
    END LOOP;

    PERFORM retire_answer_evidence(v_user,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p->'evidence_ids', '[]'::JSONB))::UUID), v_at);
END;
$$;

REVOKE ALL ON FUNCTION retire_answer(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION retire_answer_evidence(UUID, UUID[], TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_correction(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION retire_answer(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION retire_answer_evidence(UUID, UUID[], TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION apply_correction(JSONB) TO service_role;
