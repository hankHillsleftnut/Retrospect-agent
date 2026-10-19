-- 121: the product's answers to the 36 questions, each with its evidence.
--
-- Phase 2, steps 4-6 (docs/second-brain/brief-phase-2-question-store.md),
-- Option A as amended on 18 October 2026: a first best guess at every question
-- once onboarding and integrations are in, then an ambient researcher that keeps
-- strengthening or weakening each answer. A guess may be weak; it may not be
-- baseless. Every answer points to something.
--
-- The guarantees, and where each is enforced:
--
--   * One way in. Nobody -- not the app, not the backend's own key -- can write
--     these tables directly. record_answer() is the only writer, and it checks
--     everything below before saving anything.
--   * No answer without supporting evidence. Checked by record_answer, and
--     re-checked by the database at commit as a backstop.
--   * Evidence must be the person's own data.
--   * The database decides what kind of evidence something is, from the data
--     itself. A caller cannot label a health reading "their own words" to get
--     past the next rule.
--   * Questions about feelings and wants need the person's own words.
--   * Hypothesis-only questions (goal 21) can only be answered by the
--     hypothesis engine.
--   * Copies count once. Independence is counted per source document, computed
--     here, never trusted from the caller.
--   * If evidence is deleted (the person deletes an entry), an answer left with
--     no support retires itself instead of standing unsupported.
--
-- Confidence is computed when read, not stored, so it fades with time on its own:
--     confidence = support / (support + against + 2)
-- where each independent source contributes weight x 0.5^(age / half-life).
-- One quote from you: 0.33. Two: 0.50. Five: 0.71. Nothing is ever certain.
--
-- Coverage and accuracy are separate views and are never merged: coverage is
-- "can we answer this", accuracy is "were we right, when you were shown".

-- ── Evidence kinds for the remaining content types ──────────────────────────
-- Starting assumptions, like the rest of 120's assumed weights.
INSERT INTO evidence_kinds (id, label, weight, own_words) VALUES
    ('consumption', 'What they read, watch or save', 0.40, FALSE),
    ('record',      'Other synced records',          0.30, FALSE)
ON CONFLICT (id) DO NOTHING;

-- What kind of evidence a stored item is, decided from its content type.
-- Gmail is 'mail', not 'sent_mail': raw_content does not yet say which way a
-- message went, and received mail is not the person's words. Erring this way
-- costs coverage, never honesty. Unknown types are 'record', never own words.
CREATE OR REPLACE FUNCTION evidence_kind_for_content_type(p_content_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE p_content_type
        WHEN 'journal_entry'      THEN 'journal'
        WHEN 'voice_journal'      THEN 'journal'
        WHEN 'voice_recording'    THEN 'journal'
        WHEN 'text_entry'         THEN 'journal'
        WHEN 'video_entry'        THEN 'journal'
        WHEN 'onboarding_profile' THEN 'onboarding'
        WHEN 'google_docs'        THEN 'document'
        WHEN 'gmail'              THEN 'mail'
        WHEN 'calendar'           THEN 'calendar'
        WHEN 'screen_time'        THEN 'screen_time'
        WHEN 'healthkit'          THEN 'health'
        WHEN 'twitter_bookmarks'  THEN 'consumption'
        WHEN 'apple_music'        THEN 'consumption'
        WHEN 'spotify'            THEN 'consumption'
        WHEN 'youtube'            THEN 'consumption'
        WHEN 'reddit'             THEN 'consumption'
        WHEN 'tiktok'             THEN 'consumption'
        WHEN 'x'                  THEN 'consumption'
        ELSE 'record'
    END
$$;

-- ── Answers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS question_answers (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id        SMALLINT NOT NULL REFERENCES canonical_questions(id),
    answer             TEXT NOT NULL CHECK (length(btrim(answer)) > 0),
    -- Structured form where one exists (a number, a list of people).
    detail             JSONB NOT NULL DEFAULT '{}',
    status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    -- Who produced it: the first pass, the researcher, arithmetic, a direct
    -- quote, or the hypothesis engine.
    derived_by         TEXT NOT NULL CHECK (derived_by IN ('first_pass', 'researcher', 'arithmetic', 'quote', 'hypothesis')),
    -- Makes derivation idempotent: deriving the same answer twice updates it.
    derivation_key     TEXT NOT NULL,
    model_version      TEXT,
    -- The person's verdict when shown. Kept apart from confidence: "you said
    -- so" is a different thing from "we are fairly sure".
    user_verdict       TEXT CHECK (user_verdict IN ('confirmed', 'rejected')),
    verdict_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- When the evidence behind it last changed.
    last_moved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at         TIMESTAMPTZ,
    retirement_reason  TEXT,
    UNIQUE (user_id, derivation_key)
);
CREATE INDEX IF NOT EXISTS idx_question_answers_user_question
    ON question_answers(user_id, question_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS answer_evidence (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    answer_id       UUID NOT NULL REFERENCES question_answers(id) ON DELETE CASCADE,
    stance          TEXT NOT NULL CHECK (stance IN ('supports', 'contradicts')),
    -- Exactly one of these three: a fact, a promoted pattern, or a stored item.
    assertion_id    UUID REFERENCES assertions(id) ON DELETE CASCADE,
    pattern_id      UUID REFERENCES behavior_patterns(id) ON DELETE CASCADE,
    raw_content_id  UUID REFERENCES raw_content(id) ON DELETE CASCADE,
    -- Set by record_answer from the data itself, never by the caller.
    kind_id         TEXT NOT NULL REFERENCES evidence_kinds(id),
    source_key      TEXT NOT NULL,
    observed_at     TIMESTAMPTZ NOT NULL,
    excerpt         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (num_nonnulls(assertion_id, pattern_id, raw_content_id) = 1),
    UNIQUE NULLS NOT DISTINCT (answer_id, stance, assertion_id, pattern_id, raw_content_id)
);
CREATE INDEX IF NOT EXISTS idx_answer_evidence_answer ON answer_evidence(answer_id);

-- ── Backstops ───────────────────────────────────────────────────────────────

-- Does this answer have the support its question requires?
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
          AND (NOT q.requires_own_words OR k.own_words)
    )
$$;

-- At commit, an active answer must be supported. record_answer already
-- guarantees this; the trigger makes it true of any writer, including a
-- future one, or a migration run by hand.
CREATE OR REPLACE FUNCTION question_answers_require_support()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'active'
       AND EXISTS (SELECT 1 FROM question_answers WHERE id = NEW.id AND status = 'active')
       AND NOT answer_is_supported(NEW.id) THEN
        RAISE EXCEPTION 'question answer % has no supporting evidence its question accepts', NEW.id
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS question_answers_require_support ON question_answers;
CREATE CONSTRAINT TRIGGER question_answers_require_support
    AFTER INSERT OR UPDATE ON question_answers
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION question_answers_require_support();

-- When evidence disappears (the person deleted an entry, so its facts went
-- too), an answer left without support retires itself, with the reason, rather
-- than block the deletion or stand unsupported.
CREATE OR REPLACE FUNCTION answer_evidence_retire_orphans()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE question_answers a
       SET status = 'retired',
           retired_at = NOW(),
           updated_at = NOW(),
           retirement_reason = 'Its supporting evidence was deleted.'
     WHERE a.id IN (SELECT DISTINCT answer_id FROM removed)
       AND a.status = 'active'
       AND NOT answer_is_supported(a.id);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS answer_evidence_retire_orphans ON answer_evidence;
CREATE TRIGGER answer_evidence_retire_orphans
    AFTER DELETE ON answer_evidence
    REFERENCING OLD TABLE AS removed
    FOR EACH STATEMENT EXECUTE FUNCTION answer_evidence_retire_orphans();

-- ── The one way in ──────────────────────────────────────────────────────────
--
-- p = {
--   user_id, question_id, answer, detail?, derived_by, derivation_key, model_version?,
--   evidence: [{ stance?, assertion_id | pattern_id | raw_content_id, kind?, excerpt? }]
-- }
-- `kind` is optional and, if given, must match what the data actually is.
-- Re-recording the same derivation_key replaces its evidence set, and brings a
-- retired answer back if the new evidence supports it.
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
            SELECT evidence_kind_for_content_type(r.content_type),
                   COALESCE(r.dedup_key, md5(r.content)),
                   COALESCE(r.content_date, r.created_at)
              INTO v_kind, v_key, v_at
              FROM raw_content r
             WHERE r.id = (v_entry->>'raw_content_id')::UUID AND r.user_id = v_user;
        ELSIF v_entry ? 'assertion_id' AND v_entry->>'assertion_id' IS NOT NULL THEN
            -- A fact is the kind of the item it was read from, and copies of
            -- that item are one source. A fact with no stored item behind it
            -- (an integration record) is a 'record' and counts by itself.
            SELECT COALESCE(evidence_kind_for_content_type(r.content_type), 'record'),
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

-- The person's verdict on an answer they were shown.
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

-- ── Reading ─────────────────────────────────────────────────────────────────

-- Confidence for every answer, as of now.
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

-- The standing answer to each question: the most confident active answer the
-- person has not rejected. competing_answers > 1 means the evidence points
-- more than one way, which the product should say rather than pick silently.
CREATE OR REPLACE VIEW current_answers WITH (security_invoker = true) AS
SELECT DISTINCT ON (c.user_id, c.question_id)
       c.user_id, c.question_id, q.domain_id, a.id AS answer_id, a.answer, a.detail,
       c.confidence, c.independent_sources, a.user_verdict, a.last_moved_at,
       count(*) OVER (PARTITION BY c.user_id, c.question_id) AS competing_answers
FROM answer_confidence c
JOIN question_answers a ON a.id = c.answer_id
JOIN canonical_questions q ON q.id = c.question_id
WHERE c.status = 'active' AND c.user_verdict IS DISTINCT FROM 'rejected'
ORDER BY c.user_id, c.question_id, (a.user_verdict = 'confirmed') DESC NULLS LAST, c.confidence DESC;

-- Coverage, per person and domain: can we answer, and may we speak.
CREATE OR REPLACE VIEW domain_coverage WITH (security_invoker = true) AS
SELECT u.id AS user_id, d.id AS domain_id, d.label,
       count(q.id)                                                   AS questions,
       count(ca.answer_id)                                           AS answered,
       count(ca.answer_id) FILTER (WHERE ca.confidence >= d.confidence_floor
                                      OR ca.user_verdict = 'confirmed') AS confident,
       round(count(ca.answer_id) FILTER (WHERE ca.confidence >= d.confidence_floor
                                            OR ca.user_verdict = 'confirmed')::NUMERIC
             / count(q.id), 2)                                       AS coverage,
       d.speak_coverage,
       d.always_active
         OR count(ca.answer_id) FILTER (WHERE ca.confidence >= d.confidence_floor
                                           OR ca.user_verdict = 'confirmed')::NUMERIC
            / count(q.id) >= d.speak_coverage                        AS may_speak
FROM users u
CROSS JOIN question_domains d
JOIN canonical_questions q ON q.domain_id = d.id
LEFT JOIN current_answers ca ON ca.user_id = u.id AND ca.question_id = q.id
GROUP BY u.id, d.id;

-- Accuracy: of the answers a person was shown and judged, how many were right.
-- Deliberately a separate number from coverage.
CREATE OR REPLACE VIEW answer_accuracy WITH (security_invoker = true) AS
SELECT user_id,
       count(*) FILTER (WHERE user_verdict = 'confirmed') AS confirmed,
       count(*) FILTER (WHERE user_verdict = 'rejected')  AS rejected,
       round(count(*) FILTER (WHERE user_verdict = 'confirmed')::NUMERIC
             / NULLIF(count(*) FILTER (WHERE user_verdict IS NOT NULL), 0), 2) AS accuracy
FROM question_answers
GROUP BY user_id;

-- ── Access ──────────────────────────────────────────────────────────────────
ALTER TABLE question_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_evidence  ENABLE ROW LEVEL SECURITY;

-- No direct writes from anyone, including the backend's service key.
REVOKE ALL ON question_answers, answer_evidence FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON question_answers, answer_evidence TO service_role;
GRANT SELECT ON question_domains, canonical_questions, evidence_kinds TO service_role;
REVOKE ALL ON answer_confidence, current_answers, domain_coverage, answer_accuracy FROM PUBLIC, anon, authenticated;
GRANT SELECT ON answer_confidence, current_answers, domain_coverage, answer_accuracy TO service_role;

REVOKE ALL ON FUNCTION record_answer(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_answer_verdict(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_answer(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION record_answer_verdict(UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION answer_evidence_retire_orphans() FROM PUBLIC, anon, authenticated;
