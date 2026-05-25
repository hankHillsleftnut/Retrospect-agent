-- ============================================
-- 101_pipeline_run_traces.sql
-- The "X-ray" table. Every pipeline run (CLI, cron, or HTTP)
-- writes a row here with all intermediate outputs and tool calls,
-- so any run can be fully inspected in the /runs dashboard.
-- ============================================

CREATE TABLE IF NOT EXISTS pipeline_run_traces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('ingest', 'podcast', 'cookA', 'cookB', 'cookC')),
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    triggered_by TEXT DEFAULT 'manual' CHECK (triggered_by IN ('manual', 'cron', 'http', 'cli', 'replay')),

    -- exact inputs used (so replay is deterministic)
    inputs_snapshot JSONB DEFAULT '{}',

    -- intermediate outputs from each pipeline step
    outline_v1 JSONB,                  -- Cook A output
    agent_tool_calls JSONB DEFAULT '[]', -- full trace of every tool call from Cook B
    outline_v2 JSONB,                  -- Cook B enriched outline
    final_script TEXT,                 -- Cook C transcript
    audio_url TEXT,
    episode_summary TEXT,
    episode_id UUID REFERENCES podcast_episodes(id) ON DELETE SET NULL,

    -- accounting
    cost_breakdown JSONB DEFAULT '{}', -- {openai_tokens, perplexity_calls, elevenlabs_chars, est_usd}
    duration_ms INTEGER,
    error_message TEXT,

    -- arbitrary human notes ("trying new agent prompt")
    notes TEXT,

    -- replay lineage
    parent_run_id UUID REFERENCES pipeline_run_traces(id) ON DELETE SET NULL,

    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pipeline_run_traces_user ON pipeline_run_traces(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_traces_kind ON pipeline_run_traces(kind, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_traces_status ON pipeline_run_traces(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_traces_episode ON pipeline_run_traces(episode_id);

ALTER TABLE pipeline_run_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own traces" ON pipeline_run_traces
    FOR SELECT USING (user_id = auth.uid());
