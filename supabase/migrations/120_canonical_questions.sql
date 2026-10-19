-- 120: the 36 questions the product answers about each person, as data.
--
-- Phase 2, step 3 (docs/second-brain/brief-phase-2-question-store.md).
-- The product never asks these. It works the answers out from what it already
-- holds, and each answer's confidence grows as evidence builds. This migration
-- only defines the questions and the rules around them; answers come in 121.
--
-- Everything here is tunable data, not code. The numbers are the starting values
-- set in goal-specs.md ("The coverage threshold -- decided, per domain") and the
-- brief ("How confidence works"), and are expected to move once real coverage
-- and real confirmations can be measured.

-- ── Domains ─────────────────────────────────────────────────────────────────
-- A domain is a group of questions that unlocks together. Below its bar the
-- product is silent about that part of a person's life, not approximate.
CREATE TABLE IF NOT EXISTS question_domains (
    id                TEXT PRIMARY KEY,
    label             TEXT NOT NULL,
    position          SMALLINT NOT NULL UNIQUE,
    -- Share of the domain's questions that must be confidently answered before
    -- the product may speak about this domain at all.
    speak_coverage    NUMERIC(3, 2) NOT NULL CHECK (speak_coverage BETWEEN 0 AND 1),
    -- How confident one answer must be to count toward that share.
    confidence_floor  NUMERIC(3, 2) NOT NULL CHECK (confidence_floor BETWEEN 0 AND 1),
    -- How quickly evidence goes stale here. "How are you doing" fades in weeks;
    -- "what do you do for work" in a year.
    half_life_days    INTEGER NOT NULL CHECK (half_life_days > 0),
    -- Goal 22: how to speak to someone runs from the first minute at a safe
    -- default, so this domain never waits on coverage.
    always_active     BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO question_domains (id, label, position, speak_coverage, confidence_floor, half_life_days, always_active) VALUES
    ('who',       'Who they are',               1, 0.50, 0.33, 365, FALSE),
    ('want',      'What they want',             2, 0.70, 0.60, 120, FALSE),
    ('do',        'What they actually do',      3, 0.60, 0.50,  60, FALSE),
    ('attention', 'Their attention',            4, 0.60, 0.50,  60, FALSE),
    ('people',    'The people in their life',   5, 0.70, 0.60, 120, FALSE),
    ('how',       'How they are',               6, 0.80, 0.70,  14, FALSE),
    ('in_the_way','What is in the way',         7, 0.80, 0.70,  60, FALSE),
    ('speak',     'How to speak to them',       8, 0.00, 0.00, 180, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── Questions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS canonical_questions (
    id                  SMALLINT PRIMARY KEY CHECK (id BETWEEN 1 AND 99),
    domain_id           TEXT NOT NULL REFERENCES question_domains(id),
    text                TEXT NOT NULL,
    -- Where an answer can come from, as listed in canonical-questions.md.
    -- Informational: it guides the researcher, it does not gate writes.
    answerable_from     TEXT[] NOT NULL,
    -- Only the person's own words can answer this. A calendar cannot say how
    -- someone feels; an answer here backed only by records is refused.
    requires_own_words  BOOLEAN NOT NULL DEFAULT FALSE,
    -- Goal 21: answerable only as a hypothesis, under its gates (mass,
    -- framework, appetite). Never stated as fact.
    hypothesis_only     BOOLEAN NOT NULL DEFAULT FALSE,
    -- Overrides the domain's half-life where one question fades faster.
    half_life_days      INTEGER CHECK (half_life_days > 0)
);

INSERT INTO canonical_questions (id, domain_id, text, answerable_from, requires_own_words, hypothesis_only, half_life_days) VALUES
    ( 1, 'who',       'What do they do for work, concretely?',                               '{linkedin,web}',                   FALSE, FALSE, NULL),
    ( 2, 'who',       'What are they building or responsible for right now?',                '{linkedin,notion,words}',          FALSE, FALSE, 120),
    ( 3, 'who',       'How long have they been doing it?',                                   '{linkedin}',                       FALSE, FALSE, NULL),
    ( 4, 'who',       'What stage of life are they in?',                                     '{linkedin,words}',                 FALSE, FALSE, NULL),
    ( 5, 'who',       'Where do they live, and does it matter to them?',                     '{words,web}',                      FALSE, FALSE, NULL),
    ( 6, 'want',      'What have they said they want?',                                      '{words}',                          TRUE,  FALSE, NULL),
    ( 7, 'want',      'What do they spend their time on regardless of what they say?',       '{calendar,screen_time}',           FALSE, FALSE, NULL),
    ( 8, 'want',      'Where do those two disagree?',                                        '{calendar,screen_time,words}',     FALSE, FALSE, NULL),
    ( 9, 'want',      'What have they quit, and when?',                                      '{words}',                          TRUE,  FALSE, NULL),
    (10, 'want',      'What do they want that they have never named?',                       '{hypothesis}',                     FALSE, TRUE,  NULL),
    (11, 'want',      'What does success look like to them specifically?',                   '{words}',                          TRUE,  FALSE, NULL),
    (12, 'do',        'What does a normal week look like?',                                  '{calendar}',                       FALSE, FALSE, NULL),
    (13, 'do',        'What do they reliably do?',                                           '{calendar,health}',                FALSE, FALSE, NULL),
    (14, 'do',        'What do they reliably avoid or skip?',                                '{calendar,health}',                FALSE, FALSE, NULL),
    (15, 'do',        'When are they at their best, by time of day?',                        '{calendar,screen_time,health}',    FALSE, FALSE, NULL),
    (16, 'do',        'What has changed in the last month?',                                 '{calendar,screen_time,health}',    FALSE, FALSE, 30),
    (17, 'do',        'How much are they sleeping and moving?',                              '{health}',                         FALSE, FALSE, 30),
    (18, 'attention', 'What do they read or watch by choice?',                               '{screen_time,words}',              FALSE, FALSE, NULL),
    (19, 'attention', 'What do they keep returning to?',                                     '{screen_time}',                    FALSE, FALSE, NULL),
    (20, 'attention', 'What do they consume that they would say they shouldn''t?',           '{screen_time}',                    FALSE, FALSE, NULL),
    (21, 'attention', 'What are they trying to learn?',                                      '{screen_time,notion,words}',       FALSE, FALSE, NULL),
    (22, 'people',    'Who do they spend the most time with?',                               '{calendar,mail}',                  FALSE, FALSE, NULL),
    (23, 'people',    'Who matters most, as distinct from most frequent?',                   '{words}',                          TRUE,  FALSE, NULL),
    (24, 'people',    'Who do they talk about when something is hard?',                      '{words}',                          TRUE,  FALSE, NULL),
    (25, 'people',    'Who has disappeared from their life recently?',                       '{calendar,mail}',                  FALSE, FALSE, 60),
    (26, 'people',    'Who do they work for or answer to?',                                  '{linkedin,mail}',                  FALSE, FALSE, NULL),
    (27, 'how',       'How are they doing right now?',                                       '{words}',                          TRUE,  FALSE, NULL),
    (28, 'how',       'What is weighing on them?',                                           '{words}',                          TRUE,  FALSE, NULL),
    (29, 'how',       'How do they talk about themselves?',                                  '{words}',                          TRUE,  FALSE, 120),
    (30, 'how',       'Are they in an expansive phase or a depleted one?',                   '{words,health,calendar}',          FALSE, FALSE, NULL),
    (31, 'in_the_way','What pattern is costing them most?',                                  '{calendar,screen_time,health,words}', FALSE, FALSE, NULL),
    (32, 'in_the_way','What do they blame, and is it the real cause?',                       '{words,hypothesis}',               TRUE,  TRUE,  NULL),
    (33, 'in_the_way','What have they tried that did not work?',                             '{words}',                          TRUE,  FALSE, NULL),
    (34, 'speak',     'How direct can we be with them?',                                     '{appetite}',                       FALSE, FALSE, NULL),
    (35, 'speak',     'How much do they want to be pushed?',                                 '{appetite,onboarding}',            FALSE, FALSE, NULL),
    (36, 'speak',     'What would make them stop listening?',                                '{appetite,behaviour}',             FALSE, FALSE, NULL)
ON CONFLICT (id) DO NOTHING;

-- ── Evidence kinds and their weights ────────────────────────────────────────
-- Each independent piece of evidence is a vote, and this is how much one vote
-- counts. own_words marks the person's own words: the only kind that can answer
-- a requires_own_words question.
--
-- Brief values: own words 1.0, mail and documents 0.6, calendar 0.4, health
-- 0.15. The rest are starting assumptions, flagged as such:
--   * screen_time 0.4  -- a behavioural record, like calendar.
--   * sent mail, documents, public writing and profiles are the person's own
--     words but carry 0.6: written for an audience, less candid than a journal.
--   * web 0.3          -- about them, not by them, and often about a namesake.
--   * pattern 0.6      -- a promoted pattern already aggregates several facts;
--     citing it counts once, so it must not count like many.
CREATE TABLE IF NOT EXISTS evidence_kinds (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    weight     NUMERIC(3, 2) NOT NULL CHECK (weight > 0 AND weight <= 1),
    own_words  BOOLEAN NOT NULL
);

INSERT INTO evidence_kinds (id, label, weight, own_words) VALUES
    ('journal',        'Journal entry or voice note', 1.00, TRUE),
    ('onboarding',     'Onboarding answer',           1.00, TRUE),
    ('confirmation',   'They told us directly',       1.00, TRUE),
    ('sent_mail',      'Mail they sent',              0.60, TRUE),
    ('document',       'Their documents and notes',   0.60, TRUE),
    ('public_writing', 'Posts and bios',              0.60, TRUE),
    ('profile',        'Professional profile',        0.60, TRUE),
    ('mail',           'Mail metadata',               0.60, FALSE),
    ('pattern',        'A promoted pattern',          0.60, FALSE),
    ('calendar',       'Calendar',                    0.40, FALSE),
    ('screen_time',    'Screen time',                 0.40, FALSE),
    ('web',            'Public web',                  0.30, FALSE),
    ('health',         'Health data',                 0.15, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Reference data: readable by the backend, not writable by the app.
ALTER TABLE question_domains    ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_kinds      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON question_domains, canonical_questions, evidence_kinds FROM anon, authenticated;
