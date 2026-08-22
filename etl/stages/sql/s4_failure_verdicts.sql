-- Output: agg.failure_verdicts — merged per-tool_event failure verdict.
-- Columns: tool_event_id, matched_signature_id, failure_verdict
--   (rule | model_added | model_cleared | uncertain | none), j1_reason,
--   j1_confidence.
-- Merge rule (docs/architecture/etl.md Stage 4): rule counts_as_failure=true
--   → rule; rule-uncertain + J1 → J1's verdict (model_added/model_cleared);
--   rule-uncertain, no J1 (or J1 abstained) → uncertain. NULL-tolerant:
--   enrich.j1_verdicts is guaranteed to exist (empty when stage 3 skipped)
--   by prepare()'s ensureEnrichTables.
-- Contract: docs/architecture/etl.md Stage 4.
CREATE TABLE agg.failure_verdicts AS
SELECT
  e.tool_event_id,
  e.matched_signature_id,
  CASE
    WHEN e.counts_as_failure = 'true' THEN 'rule'
    WHEN e.counts_as_failure = 'uncertain' AND j1.verdict = 'failure' THEN 'model_added'
    WHEN e.counts_as_failure = 'uncertain' AND j1.verdict = 'non_failure' THEN 'model_cleared'
    WHEN e.counts_as_failure = 'uncertain' THEN 'uncertain'
    ELSE 'none'
  END AS failure_verdict,
  j1.reason AS j1_reason,
  j1.confidence AS j1_confidence
FROM derive.tool_events e
LEFT JOIN enrich.j1_verdicts j1 ON j1.tool_event_id = e.tool_event_id;
