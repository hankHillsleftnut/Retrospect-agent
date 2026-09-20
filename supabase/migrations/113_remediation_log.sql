-- ============================================
-- 113_remediation_log.sql
--
-- Every claim in this system earns trust by being traceable: facts to spans,
-- patterns to facts, episodes to packs. A repair path that mutates the bank
-- without leaving the same trail would be the one unaccountable thing in it --
-- and worse than the rot it was built to fix, because it would be invisible.
--
-- This table is the answer to "why does the bank say this now when it said
-- something else last week".
-- ============================================

CREATE TABLE IF NOT EXISTS remediation_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    capability TEXT NOT NULL CHECK (capability IN (
        'reprocess_source',
        'rerun_derivation',
        'machine_retire',
        'structural_repair',
        'merge_assertions',
        'escalate'
    )),

    -- What triggered it. Null when a human acted directly rather than on a finding.
    finding_id UUID REFERENCES lint_findings(id) ON DELETE SET NULL,
    check_id TEXT,

    target_table TEXT NOT NULL,
    target_ids UUID[] NOT NULL DEFAULT '{}',

    -- Enough to undo by hand, and to explain later.
    before_state JSONB,
    after_state JSONB,

    -- 'system' only when acting on a finding; otherwise the human who asked.
    actor TEXT NOT NULL DEFAULT 'system',
    reason TEXT NOT NULL,

    succeeded BOOLEAN NOT NULL DEFAULT true,
    error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remediation_log_user
    ON remediation_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_remediation_log_finding
    ON remediation_log(finding_id);
CREATE INDEX IF NOT EXISTS idx_remediation_log_targets
    ON remediation_log USING GIN (target_ids);

ALTER TABLE remediation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own remediation log" ON remediation_log
    FOR ALL USING (user_id = auth.uid());

COMMENT ON TABLE remediation_log IS
    'Every machine-initiated correction to the derived layer. Without this, lint becomes an unaudited mutation path into the bank.';
COMMENT ON COLUMN remediation_log.before_state IS
    'The rows as they were. Enough to reverse the change by hand.';

-- Machine-initiated retirement must be distinguishable from human feedback.
-- 'contradicted' and 'user_confirmed' are things a PERSON said; a repair is not.
ALTER TABLE assertions
    ADD COLUMN IF NOT EXISTS retired_by TEXT,
    ADD COLUMN IF NOT EXISTS retirement_reason TEXT;

COMMENT ON COLUMN assertions.retired_by IS
    'system:<check_id> for a lint-driven retirement, or a user id. Never conflate the two.';
