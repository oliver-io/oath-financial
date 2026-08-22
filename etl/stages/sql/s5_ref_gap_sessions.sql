-- Output: publish.ref_gap_sessions → ref/gap_sessions.parquet —
--   capability_gap ↔ session bridge for evidence deeplinks.
-- Columns (contracts GapSessionRowSchema): gap_id, session_id, is_exemplar
--   (J4 exemplar links, ⊆ the deterministic membership; FALSE until J4 runs).
-- Contract: docs/architecture/etl.md Stage 5 reference plane; contracts/src/rows.ts.
CREATE TABLE publish.ref_gap_sessions AS
SELECT
  gs.gap_id,
  gs.session_id,
  -- exemplar_session_ids is CSV text written by the enrichment runner.
  COALESCE(list_contains(
    string_split(j4.exemplar_session_ids, ','), gs.session_id), FALSE) AS is_exemplar
FROM agg.gap_sessions gs
LEFT JOIN enrich.j4_gaps j4 USING (gap_id);
