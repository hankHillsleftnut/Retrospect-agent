-- 143: what each saved link bears on (R1.3): the person's goals and the
-- canonical questions. Judged, with "none" allowed; additive.
ALTER TABLE reference_items ADD COLUMN IF NOT EXISTS goal_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE reference_items ADD COLUMN IF NOT EXISTS question_ids SMALLINT[] NOT NULL DEFAULT '{}';
ALTER TABLE reference_items ADD COLUMN IF NOT EXISTS related_at TIMESTAMPTZ;
