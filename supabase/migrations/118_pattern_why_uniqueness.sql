-- ============================================
-- 118_pattern_why_uniqueness.sql
--
-- Stops two concurrent promoter runs writing the same explanation twice.
--
-- The promoter avoids duplicate whys by checking first: read the pattern's live
-- whys, and insert only if there are none. Check-then-write is a race. Two runs
-- arriving together both read "none" and both insert. The promoter runs
-- serially after ingest today, so this is latent rather than live -- but it is
-- exactly the shape of bug that surfaces the day something runs in parallel.
--
-- The constraint is deliberately (pattern_id, mechanism), NOT (pattern_id).
--
-- One live why per pattern would also stop the race, and would quietly decide a
-- product question nobody has decided: whether a pattern can carry competing
-- explanations. The hypothesis engine (goal 21) may well want several -- "it
-- could be avoidance, or it could be capacity" -- held side by side until the
-- person says which. Keying on the mechanism stops the duplicate the race
-- actually produces (the same explanation twice) and forecloses nothing.
--
-- Partial on retired_at IS NULL: a retired explanation does not block a fresh
-- one with the same mechanism, if the evidence later supports it again.
--
-- The table holds no rows today, so the index creates cleanly.
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS behavior_pattern_whys_live_mechanism_uniq
    ON behavior_pattern_whys (pattern_id, mechanism)
    WHERE retired_at IS NULL;
