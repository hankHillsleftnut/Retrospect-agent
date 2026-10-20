-- 150: conversation turns (goal 18). Working memory for talking to it bit by
-- bit: what was said today, by whom. The person's turns are also saved to
-- raw_content as their own words, so the brain reads them like anything they
-- send. Its own replies live only here and are never read as facts about the
-- person (goal 19's hard line). Additive.
CREATE TABLE IF NOT EXISTS conversation_turns (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('person', 'companion')),
  text        TEXT NOT NULL,
  raw_content_id UUID REFERENCES raw_content(id) ON DELETE SET NULL,
  used        JSONB NOT NULL DEFAULT '[]',   -- for companion turns: the claims and sources it drew on
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_user_time ON conversation_turns (user_id, created_at DESC);
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON conversation_turns FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_turns TO service_role;
