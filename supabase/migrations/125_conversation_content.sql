-- 125: a conversation the person took part in, with only their own turns kept.
--
-- The founder's meeting notes (Granola) record both speakers as "Me:" and
-- "Them:". Imported whole, the other person's views would be put in the
-- founder's mouth -- the same failure as a hiring post in their Drive
-- (migration 124). The importer (scripts/import-transcript.ts) keeps only the
-- person's own turns, so a stored 'conversation' is their own spoken words and
-- counts as such: the same evidence kind as a journal entry or voice note.
--
-- Recomputes the mapping function from 121 with the one added type.
CREATE OR REPLACE FUNCTION evidence_kind_for_content_type(p_content_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE p_content_type
        WHEN 'journal_entry'      THEN 'journal'
        WHEN 'voice_journal'      THEN 'journal'
        WHEN 'voice_recording'    THEN 'journal'
        WHEN 'text_entry'         THEN 'journal'
        WHEN 'video_entry'        THEN 'journal'
        WHEN 'conversation'       THEN 'journal'
        WHEN 'onboarding_profile' THEN 'onboarding'
        WHEN 'google_docs'        THEN 'document'
        WHEN 'gmail'              THEN 'mail'
        WHEN 'calendar'           THEN 'calendar'
        WHEN 'screen_time'        THEN 'screen_time'
        WHEN 'healthkit'          THEN 'health'
        WHEN 'twitter_bookmarks'  THEN 'consumption'
        WHEN 'apple_music'        THEN 'consumption'
        WHEN 'spotify'            THEN 'consumption'
        WHEN 'youtube'            THEN 'consumption'
        WHEN 'reddit'             THEN 'consumption'
        WHEN 'tiktok'             THEN 'consumption'
        WHEN 'x'                  THEN 'consumption'
        ELSE 'record'
    END
$$;
