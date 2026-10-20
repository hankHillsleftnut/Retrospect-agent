-- 136: where an event's time goes, decided once per distinct title (W3.5b).
-- The declared rules place what they can; the rest is placed by a small model
-- once and cached here; the person's own correction always wins.
CREATE TABLE IF NOT EXISTS event_categories (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_key   TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('exercise', 'health', 'learning', 'travel', 'social', 'meetings', 'focus', 'personal', 'other')),
  decided_by  TEXT NOT NULL CHECK (decided_by IN ('model', 'person')),
  model       TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, title_key)
);
ALTER TABLE event_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_categories TO service_role;
