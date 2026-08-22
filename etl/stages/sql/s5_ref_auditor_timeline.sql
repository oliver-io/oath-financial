-- Output: publish.ref_auditor_timeline → ref/auditor_timeline.parquet —
--   agg.auditor_timeline published whole.
-- Columns (contracts AuditorTimelineRowSchema): auditor, day, turns,
--   sessions_touched, clients_touched, capped_gap_span_s, bout_count.
-- Contract: docs/architecture/etl.md Stage 5 reference plane; contracts/src/rows.ts.
CREATE TABLE publish.ref_auditor_timeline AS
SELECT
  auditor,
  day,
  CAST(turns AS INTEGER) AS turns,
  CAST(sessions_touched AS INTEGER) AS sessions_touched,
  CAST(clients_touched AS INTEGER) AS clients_touched,
  capped_gap_span_s,
  CAST(bout_count AS INTEGER) AS bout_count
FROM agg.auditor_timeline;
