-- Output: publish.ref_capability_gaps → ref/capability_gaps.parquet.
-- Columns (contracts CapabilityGapRowSchema): gap_id (stable public key from
--   the curated cluster rules, never per-run), display_name + description
--   (J4/model; NULL when degraded — the readiness-item column home),
--   evidence_pattern, session_count, auditor_count,
--   interaction_cost_estimate, series_start_day, daily_series (JSON TEXT).
-- Contract: docs/architecture/etl.md Stage 5 reference plane; contracts/src/rows.ts.
CREATE TABLE publish.ref_capability_gaps AS
SELECT
  gap_id,
  display_name,
  description,
  evidence_pattern,
  CAST(session_count AS INTEGER) AS session_count,
  CAST(auditor_count AS INTEGER) AS auditor_count,
  CAST(interaction_cost_estimate AS INTEGER) AS interaction_cost_estimate,
  series_start_day,
  CAST(to_json(daily_series) AS VARCHAR) AS daily_series
FROM agg.capability_gaps;
