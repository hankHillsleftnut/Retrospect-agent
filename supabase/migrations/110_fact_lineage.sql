-- ============================================
-- 110_fact_lineage.sql
-- Debuggability columns for the second brain.
--
-- 1. assertions.source_run_id — which pipeline run produced this fact.
--    identity_inferences already carried source_ingestion_run_id; the graph
--    tables dropped it, which breaks the chain from a lint finding back to
--    its cause. See docs/second-brain/13 "Debuggability".
--
-- 2. assertion_evidence.char_start / char_end — where exactly in the source
--    the excerpt came from, so the system can show the sentence rather than
--    a paraphrase. See docs/second-brain/04 principle 2.
--
-- Both nullable and unset by existing writers: this migration changes no
-- existing behaviour.
-- ============================================

ALTER TABLE assertions
    ADD COLUMN IF NOT EXISTS source_run_id UUID REFERENCES pipeline_run_traces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assertions_source_run
    ON assertions(source_run_id)
    WHERE source_run_id IS NOT NULL;

ALTER TABLE assertion_evidence
    ADD COLUMN IF NOT EXISTS char_start INTEGER,
    ADD COLUMN IF NOT EXISTS char_end   INTEGER;

COMMENT ON COLUMN assertions.source_run_id IS
    'Pipeline run that produced this assertion. Nullable: rows written before 110 have none.';
COMMENT ON COLUMN assertion_evidence.char_start IS
    'Start offset of excerpt within the source text. Null for structured sources with no span.';
