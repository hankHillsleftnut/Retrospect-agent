-- 131: one lineage graph over every claim (F1.2, target-architecture §3.4).
--
-- Each kind of claim already records what it rests on, in its own table
-- (docs/second-brain/f1-claims-map.md). This view joins them into one graph so
-- corrections, lint and "how do you know that" can walk from any claim down to
-- the source rows, without dual writes. Additive: a view, nothing changes how
-- anything is written.
--
--   fact    -> raw_content | source_item   (assertion_evidence, with the span)
--   pattern -> fact                        (behavior_pattern_facts)
--   why     -> pattern, fact               (behavior_pattern_whys)
--   answer  -> fact | pattern | raw_content (answer_evidence, supports/contradicts)

CREATE OR REPLACE VIEW claim_edges WITH (security_invoker = true) AS
    SELECT e.user_id, 'fact'::text AS claim_kind, e.assertion_id AS claim_id,
           CASE WHEN e.raw_content_id IS NOT NULL THEN 'raw_content' ELSE 'source_item' END AS evidence_kind,
           COALESCE(e.raw_content_id, e.source_item_id) AS evidence_id,
           e.evidence_role AS role, e.excerpt
      FROM assertion_evidence e
     WHERE e.raw_content_id IS NOT NULL OR e.source_item_id IS NOT NULL
    UNION ALL
    SELECT f.user_id, 'pattern', f.pattern_id, 'fact', f.assertion_id, f.role, NULL
      FROM behavior_pattern_facts f
    UNION ALL
    SELECT w.user_id, 'why', w.id, 'pattern', w.pattern_id, 'explains', NULL
      FROM behavior_pattern_whys w
    UNION ALL
    SELECT w.user_id, 'why', w.id, 'fact', a.assertion_id, 'supports', NULL
      FROM behavior_pattern_whys w, unnest(w.evidence_assertion_ids) AS a(assertion_id)
    UNION ALL
    SELECT ae.user_id, 'answer', ae.answer_id,
           CASE WHEN ae.assertion_id IS NOT NULL THEN 'fact'
                WHEN ae.pattern_id IS NOT NULL THEN 'pattern'
                ELSE 'raw_content' END,
           COALESCE(ae.assertion_id, ae.pattern_id, ae.raw_content_id),
           ae.stance, ae.excerpt
      FROM answer_evidence ae;

-- Service only: the app's roles never read lineage directly.
REVOKE ALL ON claim_edges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON claim_edges TO service_role;

COMMENT ON VIEW claim_edges IS
    'Every claim -> what it rests on, across facts, patterns, whys and answers. Walk it with walkEvidence().';
