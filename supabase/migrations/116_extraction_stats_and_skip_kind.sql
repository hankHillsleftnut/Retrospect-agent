-- ============================================
-- 116_extraction_stats_and_skip_kind.sql
--
-- Two small things, both of which make the pipeline legible rather than
-- changing what it does.
--
-- 1. `failure_kind` could not express "this was not a failure".
--
--    Auditing the live backlog on 18 October 2026 found 186 of the 2,024
--    "failed" rows were the pipeline working correctly: 144 duplicates it had
--    already handled, and 42 sensor summaries with no sentence in them to
--    quote. Recorded as failures, they made the system look broken, and --
--    because the classifier did not recognise its own skip wording -- they
--    would each have been retried six times on the way to the same answer.
--
--    The CHECK constraint allowed only 'transient' and 'terminal', so the
--    code that now classifies them as 'not_applicable' would have been
--    rejected by the database. This widens it.
--
-- 2. Extraction kept no record of what it discarded.
--
--    Every ingest run counts how many fact candidates it dropped and why, logs
--    it to stdout, and throws it away. The caller is fire-and-forget, so
--    nobody reads it. That number is the one honest signal of whether
--    extraction is working -- the difference between "the model invented a
--    quote" and "we had nowhere to file it" -- and it has never been stored.
--
--    Without it, "why are there only 19 facts" cannot be answered, and the
--    backlog drain about to run would produce no evidence either way.
--
-- Both columns are additive and nullable. Nothing is dropped, nothing is
-- rewritten, and every existing row remains valid.
-- ============================================

-- 1. Allow the third kind.
ALTER TABLE raw_content
    DROP CONSTRAINT IF EXISTS raw_content_failure_kind_check;

ALTER TABLE raw_content
    ADD CONSTRAINT raw_content_failure_kind_check
        CHECK (
            failure_kind IS NULL
            OR failure_kind IN ('transient', 'terminal', 'not_applicable')
        );

COMMENT ON COLUMN raw_content.failure_kind IS
    'transient -> worth retrying; terminal -> sending it again changes nothing; '
    'not_applicable -> not a failure, the pipeline correctly found nothing to extract.';

-- 2. Record what extraction discarded, and why.
ALTER TABLE pipeline_run_traces
    ADD COLUMN IF NOT EXISTS extraction_stats JSONB;

COMMENT ON COLUMN pipeline_run_traces.extraction_stats IS
    'What extraction saw and what survived. Shape: '
    '{ candidates, written, dropped, drop_reasons: { reason: count }, '
    'rows_seen, rows_skipped_idempotent }. '
    'The drop rate is the health metric for extraction: a span-verified claim '
    'that is dropped means either the model invented a quote or we had nowhere '
    'to file it, and those are opposite problems that currently share one '
    'counter.';
