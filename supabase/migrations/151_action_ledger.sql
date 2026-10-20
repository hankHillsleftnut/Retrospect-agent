-- 151: the action ledger (goal 17). Every action: what, why, which of the
-- person's own messages it came from, who approved it, and how to undo it.
-- Prepare-only for now: executors produce drafts inside Retrospect; no write
-- credentials exist. Additive.
CREATE TABLE IF NOT EXISTS actions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_class  TEXT NOT NULL,
  params        JSONB NOT NULL DEFAULT '{}',
  preview       TEXT NOT NULL,
  origin_raw_content_id UUID REFERENCES raw_content(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'done', 'rejected', 'undone', 'failed')),
  approved_by   TEXT CHECK (approved_by IN ('person', 'standing_authorisation')),
  result        JSONB,
  status_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_actions_user_status ON actions (user_id, status, created_at DESC);
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON actions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON actions TO service_role;
