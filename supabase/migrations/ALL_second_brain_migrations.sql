-- ============================================
-- 110_fact_lineage.sql
-- Debuggability columns for the second brain.
--
-- 1. assertions.source_run_id — which pipeline run produced this fact.
--    identity_inferences already carried source_ingestion_run_id; the graph
--    tables dropped it, which breaks the chain from a lint finding back to
--    its cause. See docs/second-brain/13 "Debuggability".
--
-- 2. assertion_evidence.char_start / char_end — where exactly in the source
--    the excerpt came from, so the system can show the sentence rather than
--    a paraphrase. See docs/second-brain/04 principle 2.
--
-- Both nullable and unset by existing writers: this migration changes no
-- existing behaviour.
-- ============================================

ALTER TABLE assertions
    ADD COLUMN IF NOT EXISTS source_run_id UUID REFERENCES pipeline_run_traces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assertions_source_run
    ON assertions(source_run_id)
    WHERE source_run_id IS NOT NULL;

ALTER TABLE assertion_evidence
    ADD COLUMN IF NOT EXISTS char_start INTEGER,
    ADD COLUMN IF NOT EXISTS char_end   INTEGER;

COMMENT ON COLUMN assertions.source_run_id IS
    'Pipeline run that produced this assertion. Nullable: rows written before 110 have none.';
COMMENT ON COLUMN assertion_evidence.char_start IS
    'Start offset of excerpt within the source text. Null for structured sources with no span.';
-- ============================================
-- 111_behavior_patterns.sql
-- Patterns as a FIRST-CLASS, PERSISTENT object.
--
-- Deliberately NOT the legacy `patterns` table, which is correlation/trend
-- detection over insight_units -- a different object with a different job and
-- possibly a live cron still writing it (docs/second-brain/04 §4, 05 D4).
--
-- A Pattern is promoted, never invented. Cook B must not mint one.
-- ============================================

CREATE TABLE IF NOT EXISTS behavior_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Boring machine name. Poetic labels break typed retrieval (05 D5).
    slug TEXT NOT NULL,
    label TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'candidate'
        CHECK (status IN ('candidate', 'live', 'retired', 'user_rejected')),
    severity TEXT NOT NULL DEFAULT 'standard'
        CHECK (severity IN ('standard', 'high', 'extreme')),

    -- Extreme content is stored, never narrated unasked (01 Example D, 05 D10).
    episode_promotable BOOLEAN NOT NULL DEFAULT true,

    first_seen_at TIMESTAMPTZ,
    last_seen_at  TIMESTAMPTZ,
    instance_count INTEGER NOT NULL DEFAULT 0,
    -- Instances weighted by source cadence: three calendar rows are not three
    -- journals. Without this a noisy connector manufactures patterns.
    weighted_count NUMERIC(6,2) NOT NULL DEFAULT 0,
    source_count INTEGER NOT NULL DEFAULT 0,

    -- Falls as evidence goes stale, so a loop someone stopped can die.
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    subject_entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,

    grouping_key TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    promoter_version TEXT NOT NULL DEFAULT 'v1',
    source_run_id UUID REFERENCES pipeline_run_traces(id) ON DELETE SET NULL,

    promoted_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ,
    retirement_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, grouping_key)
);

CREATE INDEX IF NOT EXISTS idx_behavior_patterns_live
    ON behavior_patterns(user_id, last_seen_at DESC)
    WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_behavior_patterns_status
    ON behavior_patterns(user_id, status);

CREATE TABLE IF NOT EXISTS behavior_pattern_facts (
    pattern_id UUID NOT NULL REFERENCES behavior_patterns(id) ON DELETE CASCADE,
    assertion_id UUID NOT NULL REFERENCES assertions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'supports'
        CHECK (role IN ('supports', 'weakly_related', 'counter_evidence')),
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pattern_id, assertion_id)
);

CREATE INDEX IF NOT EXISTS idx_pattern_facts_assertion
    ON behavior_pattern_facts(assertion_id);

-- A Why exists ONLY on a live Pattern, and is always labelled inferred.
-- User-stated reasons are Facts (said_about_self), never rows here (01 Q5).
CREATE TABLE IF NOT EXISTS behavior_pattern_whys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_id UUID NOT NULL REFERENCES behavior_patterns(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    kind TEXT NOT NULL DEFAULT 'inferred' CHECK (kind = 'inferred'),
    mechanism TEXT NOT NULL
        CHECK (mechanism IN ('avoidance', 'ambivalence', 'capacity', 'unclear')),
    confidence NUMERIC(4,3) NOT NULL DEFAULT 0.3,
    status TEXT NOT NULL DEFAULT 'provisional'
        CHECK (status IN ('provisional', 'live', 'retired', 'user_rejected')),
    evidence_assertion_ids UUID[] NOT NULL DEFAULT '{}',
    model_version TEXT,
    retired_at TIMESTAMPTZ,
    retirement_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pattern_whys_pattern
    ON behavior_pattern_whys(pattern_id)
    WHERE retired_at IS NULL;

ALTER TABLE behavior_patterns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_pattern_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_pattern_whys  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own behavior_patterns" ON behavior_patterns;
CREATE POLICY "own behavior_patterns" ON behavior_patterns
    FOR ALL USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own behavior_pattern_facts" ON behavior_pattern_facts;
CREATE POLICY "own behavior_pattern_facts" ON behavior_pattern_facts
    FOR ALL USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own behavior_pattern_whys" ON behavior_pattern_whys;
CREATE POLICY "own behavior_pattern_whys" ON behavior_pattern_whys
    FOR ALL USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_behavior_patterns_updated_at ON behavior_patterns;
CREATE TRIGGER update_behavior_patterns_updated_at
    BEFORE UPDATE ON behavior_patterns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE behavior_patterns IS
    'Repeated behaviour, promoted after a bar is met. NOT the legacy patterns table.';
COMMENT ON COLUMN behavior_patterns.episode_promotable IS
    'False for extreme severity: stored as knowledge, never narrated unasked.';
COMMENT ON COLUMN behavior_patterns.weighted_count IS
    'Instances weighted by source cadence, so a high-volume connector cannot manufacture a pattern.';
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
DROP POLICY IF EXISTS "own lint findings" ON lint_findings;
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
DROP POLICY IF EXISTS "own remediation log" ON remediation_log;
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
