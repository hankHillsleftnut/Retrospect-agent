-- 134: one row per person, per local day, per domain (W3.1, design change C8).
--
-- Records (calendar, mail, content, health) are many small items; behaviour
-- shows up in their daily shape: hours in meetings, nights up late, mail sent.
-- Patterns (W3.2), trajectory (W3.3), baseline shifts (W3.4) and the time
-- breakdown (W3.5) read these rows instead of thousands of items.
--
-- Rebuilt from raw_content, so a row can always be thrown away and recomputed.
-- source_ids keeps lineage structural: every number traces to its items.

CREATE TABLE IF NOT EXISTS daily_summaries (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  domain      TEXT NOT NULL CHECK (domain IN ('calendar', 'own_words', 'mail', 'content', 'health', 'screen_time')),
  metrics     JSONB NOT NULL DEFAULT '{}',
  items       INTEGER NOT NULL DEFAULT 0,
  source_ids  UUID[] NOT NULL DEFAULT '{}',
  built_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day, domain)
);

CREATE INDEX IF NOT EXISTS idx_daily_summaries_domain_day ON daily_summaries (user_id, domain, day DESC);

ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON daily_summaries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON daily_summaries TO service_role;
