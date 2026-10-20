-- 135: each pattern carries its trajectory (W3.3b, goal 25).
-- Recomputed from the pattern's instances whenever the promoter runs; the
-- counts it rests on are stored beside it, so "weaker" is always traceable.
ALTER TABLE behavior_patterns ADD COLUMN IF NOT EXISTS trajectory TEXT
  CHECK (trajectory IN ('weakening', 'holding', 'strengthening', 'insufficient'));
ALTER TABLE behavior_patterns ADD COLUMN IF NOT EXISTS trajectory_detail JSONB;
ALTER TABLE behavior_patterns ADD COLUMN IF NOT EXISTS trajectory_at TIMESTAMPTZ;
