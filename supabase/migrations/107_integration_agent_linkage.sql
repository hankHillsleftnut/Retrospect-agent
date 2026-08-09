-- Agent-owned linkage between provider synchronization and intelligence runs.

ALTER TABLE integration_sync_runs
    ADD COLUMN IF NOT EXISTS ingestion_trace_id UUID REFERENCES pipeline_run_traces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_integration_sync_runs_ingestion_trace
    ON integration_sync_runs(ingestion_trace_id)
    WHERE ingestion_trace_id IS NOT NULL;

ALTER TABLE evidence_links
    DROP CONSTRAINT IF EXISTS evidence_links_source_run_id_fkey;

ALTER TABLE evidence_links
    ADD CONSTRAINT evidence_links_source_run_id_fkey
    FOREIGN KEY (source_run_id) REFERENCES pipeline_run_traces(id) ON DELETE SET NULL;
