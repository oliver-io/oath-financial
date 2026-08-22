-- Output: agg.auditor_timeline — attention/rhythm per auditor per day.
-- Columns (derivations.md §4): auditor, day, turns, sessions_touched,
--   clients_touched, capped_gap_span_s, bout_count.
-- Computed on each auditor's MERGED timeline of all their turns that day
-- (prevents double-counting attention across overlapping sessions); gaps over
-- the cap start a new bout (cap from thresholds.yaml via getvariable).
-- Contract: docs/architecture/etl.md Stage 4; derivations.md §4.
CREATE TABLE agg.auditor_timeline AS
WITH t AS (
  SELECT
    s.auditor,
    s.client,
    t.session_id,
    t.timestamp,
    strftime(t.timestamp, '%Y-%m-%d') AS day
  FROM derive.turns t
  JOIN derive.sessions s USING (session_id)
),
ordered AS (
  SELECT
    *,
    epoch(timestamp - LAG(timestamp) OVER (
      PARTITION BY auditor, day ORDER BY timestamp
    )) AS gap_s
  FROM t
)
SELECT
  auditor,
  day,
  COUNT(*) AS turns,
  COUNT(DISTINCT session_id) AS sessions_touched,
  COUNT(DISTINCT client) AS clients_touched,
  COALESCE(SUM(CASE
    WHEN gap_s >= 0 AND gap_s <= CAST(getvariable('gap_cap_s') AS DOUBLE)
      THEN gap_s ELSE 0 END), 0) AS capped_gap_span_s,
  1 + COALESCE(SUM(CASE
    WHEN gap_s > CAST(getvariable('gap_cap_s') AS DOUBLE) THEN 1 ELSE 0 END), 0) AS bout_count
FROM ordered
GROUP BY auditor, day;
