-- ============================================================================
-- 153: the spend ledger (BEA.4)
--
-- Goal: every model call counted, so the per-person daily cap means what it says.
--
-- Why: the cap (spend-guard.ts) only saw what pipeline runs record in
-- pipeline_run_traces (ingest, episodes) and question_research_log (the
-- researcher). Conversation, search, corrections, briefs, onboarding goals and
-- interpretation, first passes and notifications all spent money nobody added
-- up. This ledger holds one row per cost line for every path that has no trace
-- of its own; the guard sums it alongside the two existing sources. Paths that
-- already write a trace keep doing that and never write here (no double count).
--
-- is_test: set by trigger for the backend's dev-route accounts (apple_user_id
-- 'dev-test-user:...'), so test spend can be reported apart from real spend
-- (docs/team/cost-per-user). It still counts toward that account's cap.
-- Additive.
-- ============================================================================

CREATE TABLE IF NOT EXISTS spend_ledger (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind      TEXT NOT NULL,
  usd       NUMERIC(10, 6) NOT NULL CHECK (usd >= 0),
  model     TEXT,
  is_test   BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_spend_ledger_user_at ON spend_ledger (user_id, at);
-- The staging project-wide cap sums everyone over a window.
CREATE INDEX IF NOT EXISTS idx_spend_ledger_at ON spend_ledger (at);

CREATE OR REPLACE FUNCTION spend_ledger_mark_test()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  SELECT (u.apple_user_id LIKE 'dev-test-user:%') INTO NEW.is_test
    FROM users u WHERE u.id = NEW.user_id;
  NEW.is_test := COALESCE(NEW.is_test, false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spend_ledger_mark_test ON spend_ledger;
CREATE TRIGGER trg_spend_ledger_mark_test
  BEFORE INSERT ON spend_ledger
  FOR EACH ROW EXECUTE FUNCTION spend_ledger_mark_test();

ALTER TABLE spend_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spend_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON spend_ledger TO service_role;
