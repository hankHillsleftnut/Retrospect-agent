-- ============================================
-- 115_content_authorship.sql
--
-- The system could not tell whose words it was reading.
--
-- raw_content records what a piece of material IS -- a journal entry, a Google
-- Doc, a health summary -- and nothing at all about who wrote it. Everything
-- that arrived was treated as the user speaking, because for a typed journal
-- entry that is true and nothing forced the question.
--
-- It stops being true the moment a connector is involved. Sitting in one
-- account's queue was a document beginning "My name is Farza. I am going
-- all-in on building a new interface for computers." Processed as it stood,
-- that produces a perfectly well-formed, span-verified fact about the user --
-- and span verification cannot catch it, because the quote really is in the
-- source. It checks that the words exist, not whose words they are.
--
-- Provenance has to be carried, not inferred. Three values:
--
--   self    -- the user produced it: they typed it, spoke it, answered it
--   other   -- somebody else wrote it; the user merely has a copy
--   unknown -- collected material of unclear authorship, which is most of what
--              a document connector returns, and must not be mistaken for
--              either of the first two
--
-- Only `self` content may yield statements ABOUT the user. The rest is context:
-- worth reading, worth citing, never worth putting in the user's mouth.
-- ============================================

ALTER TABLE raw_content
    ADD COLUMN IF NOT EXISTS authorship TEXT
        CHECK (authorship IS NULL OR authorship IN ('self', 'other', 'unknown'));

-- Backfill from content_type, which is the only evidence the existing rows
-- carry. Deliberately conservative: anything the user did not demonstrably
-- author themselves becomes `unknown` rather than `self`.
UPDATE raw_content
SET authorship = 'self'
WHERE authorship IS NULL
  AND content_type IN (
      'text_entry', 'journal_entry', 'voice_recording', 'voice_journal',
      'video_entry', 'onboarding_profile'
  );

-- Sensor streams are nobody's writing. They are readings, and no quotable
-- statement should ever be attributed to them.
UPDATE raw_content
SET authorship = 'other'
WHERE authorship IS NULL
  AND content_type IN (
      'healthkit', 'screen_time', 'calendar', 'apple_music', 'photos', 'contacts'
  );

-- Everything a connector fetched. A Google Doc in someone's Drive may be their
-- own essay or a brief somebody sent them, and there is no way to tell from
-- here -- so it says so.
UPDATE raw_content
SET authorship = 'unknown'
WHERE authorship IS NULL;

ALTER TABLE raw_content ALTER COLUMN authorship SET DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS idx_raw_content_authorship
    ON raw_content (user_id, authorship)
    WHERE authorship = 'self';

COMMENT ON COLUMN raw_content.authorship IS
    'Who wrote this: self (the user), other (a third party or a sensor), unknown (collected material). Only self may yield statements about the user.';
