-- ============================================
-- 117_raw_content_dedup_key.sql
--
-- Lets the database refuse a second copy of the same upload.
--
-- `POST /content` has always inserted whatever it was given. Measured against
-- production on 18 October 2026, one user's 1,000 most recent rows held 179
-- distinct pieces of content: one HealthKit day-summary stored 188 times, one
-- Google Doc 74 times. Every one of those copies started its own ingest run, and
-- the pattern promoter -- which decides what is a habit by counting recurrence --
-- saw a sync glitch as the user's defining behaviour.
--
-- What counts as "the same upload" is decided in application code, by
-- `deriveDedupKey` in the API (backend/src/services/dedup-key.ts), because the
-- rule differs by kind of content: a synced document is the same object whatever
-- date it was stamped with, while a journal sentence written on two different
-- days is two real entries. This migration only gives that decision somewhere to
-- live and something to enforce it.
--
-- Three design points, each deliberate:
--
-- 1. The index is PARTIAL -- `WHERE dedup_key IS NOT NULL`.
--    Every existing row has a null key, so the index builds cleanly against the
--    duplicated data already in production. No cleanup migration has to run
--    first, and nothing that exists today is changed or removed. Historical rows
--    can be keyed later by a separate, report-first backfill.
--
-- 2. Uniqueness is enforced by the INDEX, not by checking first.
--    A SELECT-then-INSERT races: the iOS app retries on a flaky connection, and
--    two genuinely concurrent requests would both see "not there yet" and both
--    insert. The API inserts, catches the unique violation (23505), and returns
--    the row that won -- the same pattern integrations.ts already uses for
--    source assets.
--
-- 3. `dedup_strategy` records WHICH rule produced the key.
--    If the policy changes later, only the rows a given rule touched need to be
--    re-derived, rather than every row in the table.
--
-- Not CONCURRENTLY: migrations here run inside a transaction, where a
-- concurrent index build is not allowed. The table holds a few thousand rows,
-- so the build is effectively instant and the lock is not a concern. Revisit
-- this note if raw_content grows by orders of magnitude.
-- ============================================

ALTER TABLE raw_content
    ADD COLUMN IF NOT EXISTS dedup_key TEXT,
    ADD COLUMN IF NOT EXISTS dedup_strategy TEXT
        CHECK (
            dedup_strategy IS NULL
            OR dedup_strategy IN (
                'explicit_key',
                'provider_object_id',
                'sync_day',
                'content_hash',
                'content_hash_day',
                'singleton'
            )
        );

CREATE UNIQUE INDEX IF NOT EXISTS raw_content_user_dedup_key_uniq
    ON raw_content (user_id, dedup_key)
    WHERE dedup_key IS NOT NULL;

COMMENT ON COLUMN raw_content.dedup_key IS
    'Identity of one logical upload for one user, computed by deriveDedupKey in '
    'the API. Null for rows written before migration 117, which the partial '
    'unique index ignores. Never compare across users: the index is per user.';

COMMENT ON COLUMN raw_content.dedup_strategy IS
    'Which rule produced dedup_key. Kept so a change to one rule can be '
    're-derived for only the rows that rule affected.';
