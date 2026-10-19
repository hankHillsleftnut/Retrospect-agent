-- 129: every captured item carries its trust class (W1, target-architecture §3.1).
--
-- How much an item may say about the person, decided by where it came from:
-- own_words / record / third_party / automated / reference. Set by the agent
-- when it reads an item (src/brain/trust.ts); NULL until then.
--
-- Additive: one nullable column with a check.

ALTER TABLE raw_content ADD COLUMN IF NOT EXISTS trust_class TEXT
    CHECK (trust_class IS NULL OR trust_class IN ('own_words', 'record', 'third_party', 'automated', 'reference'));

COMMENT ON COLUMN raw_content.trust_class IS
    'How much this item may say about the person (src/brain/trust.ts). Only own_words may support claims about their inner life.';
