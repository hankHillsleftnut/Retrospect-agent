-- 123: restore users.voice_persona, which production never had.
--
-- Found by `npm run db:check` on 18 October 2026. The base schema defines this
-- column, but it was never applied to production. Every reader and writer
-- has been failing there:
--   * GET /profile selects it, gets "column does not exist", and answers
--     "User not found" -- for every user.
--   * PATCH /profile/persona writes it and fails with a 500, so a chosen voice
--     is never saved and every episode uses the default.
--
-- Same definition as the base schema. IF NOT EXISTS, so it is a no-op on any
-- database that already has it.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS voice_persona TEXT DEFAULT 'thoughtful_friend';

DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT users_voice_persona_check
        CHECK (voice_persona IN ('thoughtful_friend', 'wise_mentor', 'energetic_host'));
EXCEPTION
    -- Already there (from the base schema, or a previous run).
    WHEN duplicate_object THEN NULL;
END $$;
