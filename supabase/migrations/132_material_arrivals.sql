-- 132: "material arrived" — the event that starts reading (F3.1).
--
-- Material lands in raw_content along three paths: the backend (app entries,
-- device batches), the integration sync (inside the database) and the agent.
-- Two of them never pass through the agent, so the event starts here: an
-- outbox row per person, kept by a trigger, consumed by the agent's arrivals
-- job once the person has gone quiet (F3.2). The daily crons stay as the net.
--
-- The trigger must never cost anyone an upload: any failure in it is logged
-- and swallowed, and the insert goes ahead.

CREATE TABLE IF NOT EXISTS material_arrivals (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_pending_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_arrival_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrivals         INTEGER     NOT NULL DEFAULT 0,
  claimed_at       TIMESTAMPTZ
);

ALTER TABLE material_arrivals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON material_arrivals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON material_arrivals TO service_role;

CREATE OR REPLACE FUNCTION note_material_arrival() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO material_arrivals (user_id, first_pending_at, last_arrival_at, arrivals)
    SELECT user_id, now(), now(), count(*) FROM new_rows GROUP BY user_id
    ON CONFLICT (user_id) DO UPDATE
      SET last_arrival_at = now(),
          arrivals = material_arrivals.arrivals + EXCLUDED.arrivals;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'note_material_arrival failed (upload kept): %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS raw_content_arrived ON raw_content;
CREATE TRIGGER raw_content_arrived
  AFTER INSERT ON raw_content
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION note_material_arrival();

-- People ready to be read: quiet for p_quiet, or waiting longer than p_max_wait.
-- A claim older than p_lease is treated as abandoned (the worker died).
CREATE OR REPLACE FUNCTION claim_material_arrivals(p_quiet INTERVAL, p_max_wait INTERVAL, p_lease INTERVAL, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (user_id UUID, claimed_at TIMESTAMPTZ, arrivals INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE material_arrivals m SET claimed_at = now()
  WHERE m.user_id IN (
    SELECT a.user_id FROM material_arrivals a
    WHERE (a.claimed_at IS NULL OR a.claimed_at < now() - p_lease)
      AND (a.last_arrival_at <= now() - p_quiet OR a.first_pending_at <= now() - p_max_wait)
    ORDER BY a.first_pending_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED)
  RETURNING m.user_id, m.claimed_at, m.arrivals;
$$;

-- Done with a claim. If nothing arrived since it was taken, the event is spent;
-- otherwise it stays, released, with the newer material still pending.
CREATE OR REPLACE FUNCTION finish_material_arrival(p_user UUID, p_claimed_at TIMESTAMPTZ, p_succeeded BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_succeeded THEN
    DELETE FROM material_arrivals WHERE user_id = p_user AND claimed_at = p_claimed_at AND last_arrival_at < p_claimed_at;
    IF FOUND THEN RETURN 'done'; END IF;
    UPDATE material_arrivals SET claimed_at = NULL, first_pending_at = p_claimed_at, arrivals = 0
      WHERE user_id = p_user AND claimed_at = p_claimed_at;
    RETURN 'more_arrived';
  END IF;
  UPDATE material_arrivals SET claimed_at = NULL WHERE user_id = p_user AND claimed_at = p_claimed_at;
  RETURN 'released';
END;
$$;

REVOKE ALL ON FUNCTION note_material_arrival() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_material_arrivals(INTERVAL, INTERVAL, INTERVAL, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finish_material_arrival(UUID, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_material_arrivals(INTERVAL, INTERVAL, INTERVAL, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION finish_material_arrival(UUID, TIMESTAMPTZ, BOOLEAN) TO service_role;
