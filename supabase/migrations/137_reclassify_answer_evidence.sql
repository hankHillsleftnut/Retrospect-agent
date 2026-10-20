-- 137: existing answer evidence takes its trust-based kind (W1.5).
--
-- Migration 130 decides an evidence row's kind (and so its weight) from the
-- item's trust class, but only for evidence recorded after it. Rows recorded
-- before keep their old kind until the answer is re-derived. This applies the
-- same rule to them, once. Only the kind changes; nothing is deleted, and an
-- item without a trust class keeps exactly the kind it had.
UPDATE answer_evidence e
SET kind_id = evidence_kind_for_trust(rc.content_type, rc.authorship, rc.trust_class)
FROM raw_content rc
WHERE e.raw_content_id = rc.id
  AND rc.trust_class IS NOT NULL
  AND e.kind_id IS DISTINCT FROM evidence_kind_for_trust(rc.content_type, rc.authorship, rc.trust_class);
