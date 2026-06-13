-- ============================================
-- 105_graph_edges.sql
-- MVP knowledge graph: a first-class, queryable, typed edges table over the
-- nodes that already exist (observations, insights, identity_inferences, goals).
-- This FORMALIZES relationships that today live implicitly inside
-- supporting_*_ids[] arrays and FK columns. Purely additive — no existing table
-- is altered. Append-only + provenance, mirroring identity_inferences.
-- Nodes are existing rows referenced polymorphically by (type, id); there is no
-- separate nodes table in the MVP.
-- ============================================

CREATE TABLE IF NOT EXISTS graph_edges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Polymorphic endpoints
    from_type TEXT NOT NULL CHECK (from_type IN (
        'observation', 'insight', 'identity_inference', 'goal', 'goal_candidate', 'raw_content'
    )),
    from_id UUID NOT NULL,
    to_type TEXT NOT NULL CHECK (to_type IN (
        'observation', 'insight', 'identity_inference', 'goal', 'goal_candidate', 'raw_content'
    )),
    to_id UUID NOT NULL,

    -- Loose, growable edge vocabulary (kept un-frozen on purpose — add types here
    -- as integrations and Cook 0 reveal real relationships).
    edge_type TEXT NOT NULL CHECK (edge_type IN (
        'derived_from',    -- observation -> raw_content
        'evidence_for',    -- observation / raw_content -> insight / identity_inference
        'relates_to_goal', -- observation / insight -> goal
        'supports',        -- identity_inference -> identity_inference (Cook 0, later)
        'contradicts',     -- identity_inference -> identity_inference
        'tension_with'     -- identity_inference -> identity_inference / goal
    )),

    -- Optional confidence/strength; structural backfill edges leave this null,
    -- semantic edges (Cook 0) can set it.
    weight NUMERIC(3, 2) CHECK (weight IS NULL OR (weight >= 0 AND weight <= 1)),
    metadata JSONB DEFAULT '{}',

    -- Provenance + append-only lifecycle
    source_run_id UUID REFERENCES pipeline_run_traces(id) ON DELETE SET NULL,
    superseded_by UUID REFERENCES graph_edges(id) ON DELETE SET NULL,
    retired_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Outgoing / incoming traversal + type filter (active edges only)
CREATE INDEX IF NOT EXISTS idx_graph_edges_from
    ON graph_edges(user_id, from_type, from_id)
    WHERE superseded_by IS NULL AND retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_graph_edges_to
    ON graph_edges(user_id, to_type, to_id)
    WHERE superseded_by IS NULL AND retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_graph_edges_type
    ON graph_edges(user_id, edge_type)
    WHERE superseded_by IS NULL AND retired_at IS NULL;

-- One active edge of a given type between the same two nodes
CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_unique_active
    ON graph_edges(user_id, from_type, from_id, to_type, to_id, edge_type)
    WHERE superseded_by IS NULL AND retired_at IS NULL;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own graph edges" ON graph_edges
    FOR ALL USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- updated_at trigger
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS update_graph_edges_updated_at ON graph_edges;
CREATE TRIGGER update_graph_edges_updated_at
    BEFORE UPDATE ON graph_edges
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- BACKFILL — generate the initial graph from rows you already have.
-- No new data collection. Each statement is idempotent (NOT EXISTS guard),
-- so re-running this migration is safe.
-- ============================================

-- observation -> raw_content : derived_from
INSERT INTO graph_edges (user_id, from_type, from_id, to_type, to_id, edge_type)
SELECT o.user_id, 'observation', o.id, 'raw_content', o.raw_content_id, 'derived_from'
FROM observations o
WHERE o.raw_content_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM graph_edges e
    WHERE e.from_type = 'observation' AND e.from_id = o.id
      AND e.to_type = 'raw_content' AND e.to_id = o.raw_content_id
      AND e.edge_type = 'derived_from'
      AND e.superseded_by IS NULL AND e.retired_at IS NULL
  );

-- observation -> goal : relates_to_goal
INSERT INTO graph_edges (user_id, from_type, from_id, to_type, to_id, edge_type)
SELECT o.user_id, 'observation', o.id, 'goal', o.goal_id, 'relates_to_goal'
FROM observations o
WHERE o.goal_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM graph_edges e
    WHERE e.from_type = 'observation' AND e.from_id = o.id
      AND e.to_type = 'goal' AND e.to_id = o.goal_id
      AND e.edge_type = 'relates_to_goal'
      AND e.superseded_by IS NULL AND e.retired_at IS NULL
  );

-- insight -> observation : evidence_for (from supporting_observation_ids[])
INSERT INTO graph_edges (user_id, from_type, from_id, to_type, to_id, edge_type)
SELECT i.user_id, 'insight', i.id, 'observation', obs_id, 'evidence_for'
FROM insights i, unnest(i.supporting_observation_ids) AS obs_id
WHERE obs_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM graph_edges e
    WHERE e.from_type = 'insight' AND e.from_id = i.id
      AND e.to_type = 'observation' AND e.to_id = obs_id
      AND e.edge_type = 'evidence_for'
      AND e.superseded_by IS NULL AND e.retired_at IS NULL
  );

-- insight -> goal : relates_to_goal
INSERT INTO graph_edges (user_id, from_type, from_id, to_type, to_id, edge_type)
SELECT i.user_id, 'insight', i.id, 'goal', i.goal_id, 'relates_to_goal'
FROM insights i
WHERE i.goal_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM graph_edges e
    WHERE e.from_type = 'insight' AND e.from_id = i.id
      AND e.to_type = 'goal' AND e.to_id = i.goal_id
      AND e.edge_type = 'relates_to_goal'
      AND e.superseded_by IS NULL AND e.retired_at IS NULL
  );

-- identity_inference -> observation : evidence_for (from supporting_observation_ids[])
INSERT INTO graph_edges (user_id, from_type, from_id, to_type, to_id, edge_type)
SELECT inf.user_id, 'identity_inference', inf.id, 'observation', obs_id, 'evidence_for'
FROM identity_inferences inf, unnest(inf.supporting_observation_ids) AS obs_id
WHERE obs_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM graph_edges e
    WHERE e.from_type = 'identity_inference' AND e.from_id = inf.id
      AND e.to_type = 'observation' AND e.to_id = obs_id
      AND e.edge_type = 'evidence_for'
      AND e.superseded_by IS NULL AND e.retired_at IS NULL
  );

-- identity_inference -> raw_content : evidence_for (from supporting_raw_content_ids[])
INSERT INTO graph_edges (user_id, from_type, from_id, to_type, to_id, edge_type)
SELECT inf.user_id, 'identity_inference', inf.id, 'raw_content', rc_id, 'evidence_for'
FROM identity_inferences inf, unnest(inf.supporting_raw_content_ids) AS rc_id
WHERE rc_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM graph_edges e
    WHERE e.from_type = 'identity_inference' AND e.from_id = inf.id
      AND e.to_type = 'raw_content' AND e.to_id = rc_id
      AND e.edge_type = 'evidence_for'
      AND e.superseded_by IS NULL AND e.retired_at IS NULL
  );

-- ============================================
-- Query helper — bounded neighbour walk over active edges (both directions).
-- Starter for Cook A/B subgraph retrieval; depth-bounded so cycles terminate.
-- ============================================
CREATE OR REPLACE FUNCTION graph_neighbors(
    p_user_id UUID,
    p_node_type TEXT,
    p_node_id UUID,
    p_depth INT DEFAULT 1
)
RETURNS TABLE (node_type TEXT, node_id UUID, edge_type TEXT, depth INT)
LANGUAGE sql STABLE
AS $$
    WITH RECURSIVE walk AS (
        SELECT p_node_type AS node_type, p_node_id AS node_id, NULL::text AS edge_type, 0 AS depth
        UNION ALL
        SELECT
            CASE WHEN e.from_type = w.node_type AND e.from_id = w.node_id THEN e.to_type ELSE e.from_type END,
            CASE WHEN e.from_type = w.node_type AND e.from_id = w.node_id THEN e.to_id ELSE e.from_id END,
            e.edge_type,
            w.depth + 1
        FROM walk w
        JOIN graph_edges e
            ON e.user_id = p_user_id
            AND e.superseded_by IS NULL AND e.retired_at IS NULL
            AND ((e.from_type = w.node_type AND e.from_id = w.node_id)
              OR (e.to_type = w.node_type AND e.to_id = w.node_id))
        WHERE w.depth < p_depth
    )
    SELECT node_type, node_id, edge_type, depth FROM walk WHERE depth > 0;
$$;
