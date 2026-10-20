-- 147: saved links are found by meaning too (gate R1.5). They had no vector,
-- so "ice bath routine" never found "Cold exposure protocol": 18 of 28
-- paraphrased searches found their link, against 22 of 22 sharing a word.
ALTER TABLE reference_items ADD COLUMN IF NOT EXISTS embedding vector(3072);

CREATE OR REPLACE FUNCTION search_person(p_user UUID, p_query TEXT, p_embedding vector DEFAULT NULL, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (kind TEXT, id UUID, snippet TEXT, happened_at TIMESTAMPTZ, score DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Any of the words, ranked by how many and how close (gate S1.3: "race
  -- signup" found nothing in "signed up for the half marathon" when every
  -- word had to match).
  WITH q AS (SELECT websearch_to_tsquery('english', regexp_replace(trim(p_query), '\s+', ' or ', 'g')) AS tsq),
  kw_items AS (
    SELECT 'item'::TEXT AS kind, r.id, row_number() OVER (ORDER BY ts_rank_cd(to_tsvector('english', coalesce(r.content, '')), q.tsq) DESC) AS rnk
      FROM raw_content r, q
     WHERE r.user_id = p_user AND to_tsvector('english', coalesce(r.content, '')) @@ q.tsq
     LIMIT 100
  ),
  others AS (
    SELECT 'fact'::TEXT AS kind, a.id, replace(a.predicate, '_', ' ') || ': ' || coalesce(a.object_value->>'raw', a.object_value->>'normalized', '') AS body, coalesce(a.event_time, a.observed_at) AS happened_at
      FROM assertions a WHERE a.user_id = p_user AND a.status = 'active' AND a.valid_to IS NULL
    UNION ALL
    SELECT 'answer', qa.id, cq.text || ' ' || qa.answer, qa.last_moved_at
      FROM question_answers qa JOIN canonical_questions cq ON cq.id = qa.question_id
     WHERE qa.user_id = p_user AND qa.status = 'active' AND qa.user_verdict IS DISTINCT FROM 'rejected'
    UNION ALL
    SELECT 'saved', ri.id, coalesce(ri.title, '') || ' ' || coalesce(ri.summary, '') || ' ' || coalesce(ri.intent, '') || ' ' || ri.url, ri.created_at
      FROM reference_items ri WHERE ri.user_id = p_user
  ),
  kw_others AS (
    SELECT o.kind, o.id, row_number() OVER (PARTITION BY o.kind ORDER BY ts_rank_cd(to_tsvector('english', o.body), q.tsq) DESC) AS rnk
      FROM others o, q WHERE to_tsvector('english', o.body) @@ q.tsq
  ),
  sem AS (
    SELECT 'item'::TEXT AS kind, r.id, row_number() OVER (ORDER BY r.embedding <=> p_embedding) AS rnk
      FROM raw_content r
     WHERE p_embedding IS NOT NULL AND r.user_id = p_user AND r.embedding IS NOT NULL
     ORDER BY r.embedding <=> p_embedding LIMIT 100
  ),
  sem_saved AS (
    SELECT 'saved'::TEXT AS kind, ri.id, row_number() OVER (ORDER BY ri.embedding <=> p_embedding) AS rnk
      FROM reference_items ri
     WHERE p_embedding IS NOT NULL AND ri.user_id = p_user AND ri.embedding IS NOT NULL
     ORDER BY ri.embedding <=> p_embedding LIMIT 50
  ),
  fused AS (
    SELECT kind, id, sum(1.0 / (60 + rnk)) AS score
      FROM (SELECT * FROM kw_items UNION ALL SELECT * FROM kw_others UNION ALL SELECT * FROM sem UNION ALL SELECT * FROM sem_saved) x GROUP BY kind, id
  ),
  ranked AS (
    SELECT f.*, row_number() OVER (PARTITION BY f.kind ORDER BY f.score DESC) AS kind_rank FROM fused f
  )
  SELECT r.kind, r.id,
         left(coalesce((SELECT rc.content FROM raw_content rc WHERE rc.id = r.id AND r.kind = 'item'), (SELECT o.body FROM others o WHERE o.id = r.id AND o.kind = r.kind)), 400),
         coalesce((SELECT rc.created_at FROM raw_content rc WHERE rc.id = r.id AND r.kind = 'item'), (SELECT o.happened_at FROM others o WHERE o.id = r.id AND o.kind = r.kind)),
         r.score
    FROM ranked r
   WHERE r.kind_rank <= CASE r.kind WHEN 'item' THEN 10 ELSE 5 END
   ORDER BY r.score DESC LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION search_person(UUID, TEXT, vector, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION search_person(UUID, TEXT, vector, INTEGER) TO service_role;
