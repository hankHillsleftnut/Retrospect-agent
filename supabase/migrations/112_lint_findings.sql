-- ============================================
-- 112_lint_findings.sql
--
-- Rot is the documented failure mode of this system: identity_inferences
-- carried superseded_by / retired_at / retirement_reason and the audit found
-- rows were never retired. Nothing else in the pipeline notices decay,
-- because every other component only looks at what it is currently writing.
--
-- ONE STABLE ROW PER FINDING, not one per run. A nightly job writing a new
-- row each time gives you the same finding thirty times, no way to tell new
-- from persistent, and no date to correlate against a deploy.
-- first_seen_at is the most useful debugging field here.
-- ============================================

CREATE TABLE IF NOT EXISTS lint_findings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    check_id TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('safety', 'bug', 'rot', 'info')),

    -- The rows this is about. A count is not actionable.
    subject_kind TEXT NOT NULL,
    subject_ids UUID[] NOT NULL DEFAULT '{}',
    -- Stable identity of the finding, so re-running updates rather than piles up.
    fingerprint TEXT NOT NULL,

    -- Denormalised so a reader never needs the catalog to understand a row.
    prevents TEXT NOT NULL,
    detail TEXT,
    suggested_remediation TEXT NOT NULL,

    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_count INTEGER NOT NULL DEFAULT 1,

    resolution TEXT NOT NULL DEFAULT 'open'
        CHECK (resolution IN ('open', 'acknowledged', 'false_positive', 'resolved')),
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, check_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_lint_findings_open
    ON lint_findings(user_id, severity, first_seen_at DESC)
    WHERE resolution = 'open';

-- Safety findings must be reachable without wading through maintenance.
CREATE INDEX IF NOT EXISTS idx_lint_findings_safety
    ON lint_findings(user_id, first_seen_at DESC)
    WHERE severity = 'safety' AND resolution = 'open';

ALTER TABLE lint_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own lint findings" ON lint_findings
    FOR ALL USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_lint_findings_updated_at ON lint_findings;
CREATE TRIGGER update_lint_findings_updated_at
    BEFORE UPDATE ON lint_findings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON COLUMN lint_findings.first_seen_at IS
    'When this finding first appeared. Correlate against deploys: a finding from three weeks ago points at a change three weeks ago.';
COMMENT ON COLUMN lint_findings.prevents IS
    'The sentence a user would have heard if this went undetected. A check without one does not belong in lint.';
