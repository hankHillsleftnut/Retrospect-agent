-- 142: the reference bank (R1, goal 23): links the person sends, with their
-- reason. Kept apart from claims: a page's content is never evidence about the
-- person (trust class 'reference'); only their note is their words.
CREATE TABLE IF NOT EXISTS reference_items (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_content_id UUID NOT NULL REFERENCES raw_content(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  intent         TEXT,
  title          TEXT,
  summary        TEXT,
  topics         TEXT[] NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'enriched', 'failed', 'unsafe')),
  fetched_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (raw_content_id, url)
);
CREATE INDEX IF NOT EXISTS idx_reference_items_user ON reference_items (user_id, created_at DESC);
ALTER TABLE reference_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON reference_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON reference_items TO service_role;
