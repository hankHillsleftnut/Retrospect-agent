-- 144: hybrid search over one person's life (S1.1, goal 6).
-- Calibrated (goal-research-matrix.md, goal 6): keyword and meaning ranked
-- separately, fused by reciprocal rank fusion (k = 60). Searches their items,
-- the facts about them, their answers and their saved links. Items without an
-- embedding are still found by keyword. One person only, always.
CREATE OR REPLACE FUNCTION search_person(p_user UUID, p_query TEXT, p_embedding vector DEFAULT NULL, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (kind TEXT, id UUID, snippet TEXT, happened_at TIMESTAMPTZ, score DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (SELECT websearch_to_tsquery('english', p_query) AS tsq),
  docs AS (
    SELECT 'item'::TEXT AS kind, r.id, r.content AS body, r.created_at AS happened_at, r.embedding
      FROM raw_content r WHERE r.user_id = p_user
    UNION ALL
    SELECT 'fact', a.id, replace(a.predicate, '_', ' ') || ': ' || coalesce(a.object_value->>'raw', a.object_value->>'normalized', ''), coalesce(a.event_time, a.observed_at), NULL::vector
      FROM assertions a WHERE a.user_id = p_user AND a.status = 'active' AND a.valid_to IS NULL
    UNION ALL
    SELECT 'answer', qa.id, cq.text || ' ' || qa.answer, qa.last_moved_at, NULL::vector
      FROM question_answers qa JOIN canonical_questions cq ON cq.id = qa.question_id
     WHERE qa.user_id = p_user AND qa.status = 'active' AND qa.user_verdict IS DISTINCT FROM 'rejected'
    UNION ALL
    SELECT 'saved', ri.id, coalesce(ri.title, '') || ' ' || coalesce(ri.summary, '') || ' ' || coalesce(ri.intent, '') || ' ' || ri.url, ri.created_at, NULL::vector
      FROM reference_items ri WHERE ri.user_id = p_user
  ),
  kw AS (
    SELECT d.kind, d.id, row_number() OVER (ORDER BY ts_rank_cd(to_tsvector('english', d.body), q.tsq) DESC) AS rnk
      FROM docs d, q WHERE to_tsvector('english', d.body) @@ q.tsq
     LIMIT 100
  ),
  sem AS (
    SELECT d.kind, d.id, row_number() OVER (ORDER BY d.embedding <=> p_embedding) AS rnk
      FROM docs d WHERE p_embedding IS NOT NULL AND d.embedding IS NOT NULL
     ORDER BY d.embedding <=> p_embedding LIMIT 100
  ),
  fused AS (
    SELECT kind, id, sum(1.0 / (60 + rnk)) AS score FROM (SELECT * FROM kw UNION ALL SELECT * FROM sem) x GROUP BY kind, id
  )
  SELECT f.kind, f.id, left(d.body, 400), d.happened_at, f.score
    FROM fused f JOIN docs d ON d.kind = f.kind AND d.id = f.id
   ORDER BY f.score DESC LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION search_person(UUID, TEXT, vector, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION search_person(UUID, TEXT, vector, INTEGER) TO service_role;
