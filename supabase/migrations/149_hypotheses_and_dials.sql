-- 149: hypotheses (goal 21) and product dials.
--
-- A hypothesis is a claim the person's own words don't directly support. It is
-- stored with its named framework and the claims it rests on, so "why do you
-- think that" always has an answer. It is spoken only as a question, only when
-- every gate passes. Additive.
--
-- product_dials: settings the founder turns during testing without a deploy
-- (goal 21: "the dial must be adjustable without a deploy").

CREATE TABLE IF NOT EXISTS hypotheses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  framework     TEXT NOT NULL,
  domain_id     TEXT,
  question      TEXT NOT NULL,
  rationale     TEXT,
  supports      JSONB NOT NULL DEFAULT '[]',   -- [{kind, id}] the claims it rests on
  status        TEXT NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'offered', 'confirmed', 'declined', 'expired')),
  offered_count INTEGER NOT NULL DEFAULT 0,
  last_offered_at TIMESTAMPTZ,
  status_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_version TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hypotheses_user_status ON hypotheses (user_id, status);
ALTER TABLE hypotheses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hypotheses FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hypotheses TO service_role;

CREATE TABLE IF NOT EXISTS product_dials (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE product_dials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_dials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_dials TO service_role;

-- Off until the founder turns it: hypotheses are stored, never spoken.
INSERT INTO product_dials (key, value, note) VALUES
  ('hypotheses', '{"speak": false, "min_appetite": 2, "per_episode": 1, "expire_days": 30}', 'goal 21: how bold, turned during testing')
ON CONFLICT (key) DO NOTHING;
