-- 148: a rejected claim is never resurrected (goal 20, F-C2).
--
-- When the person rejects a fact or an answer, its key is recorded here. Any
-- later insert or update with the same key (the same claim from another entry, or the
-- same answer re-derived) is still stored, so lineage is kept, but stored
-- retired. Enforced in the database so every writer is covered. Additive: a
-- table and two triggers; write_fact and record_answer are unchanged.

CREATE TABLE IF NOT EXISTS claim_rejections (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_kind  TEXT NOT NULL CHECK (claim_kind IN ('fact', 'answer')),
  claim_key   TEXT NOT NULL,
  source_id   UUID,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, claim_kind, claim_key)
);
ALTER TABLE claim_rejections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON claim_rejections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON claim_rejections TO service_role;

-- What makes two facts "the same claim": predicate and object.
CREATE OR REPLACE FUNCTION fact_claim_key(p_predicate TEXT, p_object_entity UUID, p_object_value JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_predicate || '|' || coalesce(p_object_entity::text, lower(trim(coalesce(p_object_value->>'normalized', p_object_value->>'raw', ''))))
$$;

-- Two answers are the same claim when the question and the words match, ignoring case and punctuation.
CREATE OR REPLACE FUNCTION answer_claim_key(p_question INTEGER, p_answer TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_question::text || '|' || trim(regexp_replace(lower(coalesce(p_answer, '')), '[^a-z0-9]+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION keep_rejected_fact_retired() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM claim_rejections r WHERE r.user_id = NEW.user_id AND r.claim_kind = 'fact'
              AND r.claim_key = fact_claim_key(NEW.predicate, NEW.object_entity_id, NEW.object_value)) THEN
    NEW.status := 'retired';
    NEW.valid_to := coalesce(NEW.valid_to, now());
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION keep_rejected_answer_retired() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rejected BOOLEAN;
BEGIN
  v_rejected := EXISTS (SELECT 1 FROM claim_rejections r WHERE r.user_id = NEW.user_id AND r.claim_kind = 'answer'
                         AND r.claim_key = answer_claim_key(NEW.question_id, NEW.answer));
  IF v_rejected THEN
    NEW.status := 'retired';
    NEW.retired_at := coalesce(NEW.retired_at, now());
  ELSIF TG_OP = 'UPDATE' AND OLD.user_verdict = 'rejected'
        AND answer_claim_key(NEW.question_id, NEW.answer) <> answer_claim_key(OLD.question_id, OLD.answer) THEN
    -- Re-derived to different words: the old verdict was about the old words.
    NEW.user_verdict := NULL;
    NEW.verdict_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rejected_fact_stays_retired ON assertions;
CREATE TRIGGER trg_rejected_fact_stays_retired BEFORE INSERT OR UPDATE OF predicate, object_entity_id, object_value, status ON assertions
  FOR EACH ROW EXECUTE FUNCTION keep_rejected_fact_retired();
DROP TRIGGER IF EXISTS trg_rejected_answer_stays_retired ON question_answers;
CREATE TRIGGER trg_rejected_answer_stays_retired BEFORE INSERT OR UPDATE OF question_id, answer, status ON question_answers
  FOR EACH ROW EXECUTE FUNCTION keep_rejected_answer_retired();
