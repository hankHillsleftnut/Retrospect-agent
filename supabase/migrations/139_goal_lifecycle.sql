-- 139: goals have a lifecycle (goal 7: stated, active, quit, achieved,
-- expired), and duplicates point to the goal they repeat. Additive.
-- is_active stays in step (active = true) so existing readers are unchanged.
-- Founder's call, 19 Oct: merge near-duplicates; expire goals untouched and
-- unmentioned for 90 days; kept, never deleted, revivable.
ALTER TABLE goals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'quit', 'achieved', 'expired', 'merged'));
ALTER TABLE goals ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES goals(id) ON DELETE SET NULL;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS last_mentioned_at TIMESTAMPTZ;
UPDATE goals SET status = 'expired', status_reason = 'inactive before lifecycle existed', status_at = now()
 WHERE is_active = false AND status = 'active';
