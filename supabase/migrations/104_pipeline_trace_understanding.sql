-- ============================================
-- 104_pipeline_trace_understanding.sql
-- Adds columns to pipeline_run_traces for the new identity / cook 0 fields
-- that trace.ts now writes via setIdentityInferenceIds / setUserUnderstanding
-- / setCook0Failure. Without these columns, the trace UPDATE silently fails
-- (Postgres rejects the whole statement if any SET column is unknown),
-- leaving runs stuck at status='running' and the dashboard unable to render
-- the new panels.
-- ============================================

ALTER TABLE pipeline_run_traces
    ADD COLUMN IF NOT EXISTS identity_inference_ids UUID[] DEFAULT '{}';

ALTER TABLE pipeline_run_traces
    ADD COLUMN IF NOT EXISTS user_understanding_document JSONB;

ALTER TABLE pipeline_run_traces
    ADD COLUMN IF NOT EXISTS user_understanding_version INTEGER;

ALTER TABLE pipeline_run_traces
    ADD COLUMN IF NOT EXISTS cook0_error TEXT;
