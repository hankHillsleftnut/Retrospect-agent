-- 122: what the ambient researcher looked at, and when.
--
-- The researcher (src/questions/run-research.ts) re-reads a person's data
-- question by question, strengthening or weakening each answer. This log is
-- how it knows what is new since it last looked, so it never pays to re-read
-- the same material, and how anyone can see what it has been doing.
--
-- Unlike the answer tables, this is ordinary bookkeeping: the backend writes it
-- directly. It holds no claims about the person.
CREATE TABLE IF NOT EXISTS question_research_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id     SMALLINT NOT NULL REFERENCES canonical_questions(id),
    researched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- What the material seen ran up to; the next run starts after it.
    material_until  TIMESTAMPTZ NOT NULL,
    items_read      INTEGER NOT NULL CHECK (items_read >= 0),
    outcome         TEXT NOT NULL CHECK (outcome IN (
                        'unchanged', 'strengthened', 'weakened', 'revised', 'first_answer',
                        'no_basis', 'unsupported', 'refused', 'failed')),
    answer_id       UUID REFERENCES question_answers(id) ON DELETE SET NULL,
    detail          TEXT,
    cost_usd        NUMERIC(8, 4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_question_research_log_latest
    ON question_research_log(user_id, question_id, researched_at DESC);

ALTER TABLE question_research_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON question_research_log FROM anon, authenticated;
