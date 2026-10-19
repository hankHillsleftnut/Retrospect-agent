-- 126: an entry the person typed or spoke is theirs, without the app having to say so.
--
-- Migration 115 added raw_content.authorship and backfilled existing rows from
-- their content type, then set the column's default to 'unknown'. But the API
-- that saves app entries never sets authorship -- so from then on every journal
-- entry, voice note and text entry would have arrived as 'unknown'. With 124
-- (only 'self' counts as the person's own words) and the facts-only extractor
-- (no claims about the user from items not known to be theirs), a newly typed
-- entry would have taught the product nothing about its author.
--
-- Found 18 October 2026 by the test suite, while merging 124 on top of 115;
-- no production rows had been affected yet.
--
-- The fix lives in the database so it holds for every writer: an item that
-- arrives without authorship gets it from its type, by the same rules as 115's
-- backfill. An explicit value is always respected.

ALTER TABLE raw_content ALTER COLUMN authorship DROP DEFAULT;

CREATE OR REPLACE FUNCTION raw_content_default_authorship()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.authorship IS NULL THEN
        NEW.authorship := CASE
            WHEN NEW.content_type IN ('text_entry', 'journal_entry', 'voice_recording', 'voice_journal',
                                      'video_entry', 'onboarding_profile', 'conversation') THEN 'self'
            WHEN NEW.content_type IN ('healthkit', 'screen_time', 'calendar', 'apple_music', 'photos', 'contacts') THEN 'other'
            ELSE 'unknown'
        END;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS raw_content_default_authorship ON raw_content;
CREATE TRIGGER raw_content_default_authorship
    BEFORE INSERT ON raw_content
    FOR EACH ROW EXECUTE FUNCTION raw_content_default_authorship();
