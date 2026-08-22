-- Output: agg.capability_gaps — the product-side feature-request ledger.
-- Columns (derivations.md §7): gap_id (stable, from the curated cluster rules
--   — never per-run sequences), display_name, description (both J4/model —
--   NULL without enrichment; the "description column home" readiness item
--   lands here and in ref/capability_gaps), evidence_pattern (deterministic
--   stage-2/4 shape), session_count, auditor_count, interaction_cost_estimate
--   (workaround turns — the backlog ranking key), series_start_day,
--   daily_series (sessions/day by session first day; LIST — stage 5 encodes).
-- Contract: docs/architecture/etl.md Stage 4; derivations.md §7.
CREATE TABLE agg.capability_gaps AS
WITH member AS (
  SELECT
    gs.gap_id,
    gs.session_id,
    gs.workaround_turns,
    s.auditor,
    substr(s.first_ts, 1, 10) AS start_day
  FROM agg.gap_sessions gs
  JOIN derive.sessions s USING (session_id)
),
per_gap AS (
  SELECT
    gap_id,
    COUNT(*) AS session_count,
    COUNT(DISTINCT auditor) AS auditor_count,
    SUM(workaround_turns) AS interaction_cost_estimate,
    MIN(start_day) AS series_start_day,
    MAX(start_day) AS series_end_day
  FROM member
  GROUP BY gap_id
),
daily AS (
  SELECT gap_id, start_day, COUNT(*) AS n FROM member GROUP BY gap_id, start_day
),
span_days AS (
  SELECT
    p.gap_id,
    unnest(generate_series(
      CAST(p.series_start_day AS DATE),
      CAST(p.series_end_day AS DATE),
      INTERVAL 1 DAY
    )) AS d
  FROM per_gap p
),
series AS (
  SELECT
    sd.gap_id,
    list(COALESCE(dl.n, 0) ORDER BY sd.d) AS daily_series
  FROM span_days sd
  LEFT JOIN daily dl ON dl.gap_id = sd.gap_id AND dl.start_day = strftime(sd.d, '%Y-%m-%d')
  GROUP BY sd.gap_id
)
SELECT
  g.gap_id,
  j4.display_name,
  j4.description,
  g.evidence_pattern,
  COALESCE(p.session_count, 0) AS session_count,
  COALESCE(p.auditor_count, 0) AS auditor_count,
  COALESCE(p.interaction_cost_estimate, 0) AS interaction_cost_estimate,
  p.series_start_day,
  COALESCE(se.daily_series, []) AS daily_series
FROM _gap_rules g
LEFT JOIN per_gap p USING (gap_id)
LEFT JOIN series se USING (gap_id)
LEFT JOIN enrich.j4_gaps j4 USING (gap_id);
