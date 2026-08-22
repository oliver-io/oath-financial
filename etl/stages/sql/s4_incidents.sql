-- Output: agg.incidents — temporal clusters of failures.
-- Columns (derivations.md §6): incident_id (pattern_id || ':' || start_day —
--   data-derived, stable across re-runs, never a per-run sequence),
--   signature_ids (LIST; single-signature windows in this detector),
--   start_ts, end_ts (min/max event ts inside the excursion window),
--   blast_sessions, blast_auditors, blast_clients, linked_friction_cost
--   (model rollup; NULL without enrichment — M3+).
-- Detection: a day is a rate excursion when the signature's failure-counting
--   daily count exceeds baseline * incident_excursion_multiplier AND >= 3
--   events (small-n guard); baseline = events / days across the signature's
--   active span (inclusive, zero days counted). Consecutive excursion days
--   merge into one incident.
-- Contract: docs/architecture/etl.md Stage 4; derivations.md §6.
CREATE TABLE agg.incidents AS
WITH ev AS (
  SELECT
    e.matched_signature_id AS pattern_id,
    e.timestamp,
    strftime(e.timestamp, '%Y-%m-%d') AS day,
    e.session_id,
    s.auditor,
    s.client
  FROM derive.tool_events e
  JOIN derive.sessions s USING (session_id)
  WHERE e.matched_signature_id IS NOT NULL AND e.counts_as_failure = 'true'
),
daily AS (
  SELECT pattern_id, day, COUNT(*) AS n FROM ev GROUP BY pattern_id, day
),
base AS (
  SELECT
    pattern_id,
    SUM(n) * 1.0 /
      (date_diff('day', MIN(CAST(day AS DATE)), MAX(CAST(day AS DATE))) + 1) AS baseline
  FROM daily
  GROUP BY pattern_id
),
exc AS (
  SELECT d.pattern_id, CAST(d.day AS DATE) AS day
  FROM daily d
  JOIN base b USING (pattern_id)
  WHERE d.n > b.baseline * CAST(getvariable('incident_excursion_multiplier') AS DOUBLE)
    AND d.n >= 3
),
grp AS (
  SELECT
    pattern_id,
    day,
    day - CAST(ROW_NUMBER() OVER (PARTITION BY pattern_id ORDER BY day) AS INTEGER) AS g
  FROM exc
),
win AS (
  SELECT pattern_id, MIN(day) AS start_day, MAX(day) AS end_day
  FROM grp
  GROUP BY pattern_id, g
)
SELECT
  w.pattern_id || ':' || strftime(w.start_day, '%Y-%m-%d') AS incident_id,
  [w.pattern_id] AS signature_ids,
  MIN(ev.timestamp) AS start_ts,
  MAX(ev.timestamp) AS end_ts,
  COUNT(DISTINCT ev.session_id) AS blast_sessions,
  COUNT(DISTINCT ev.auditor) AS blast_auditors,
  COUNT(DISTINCT ev.client) AS blast_clients,
  CAST(NULL AS DOUBLE) AS linked_friction_cost
FROM win w
JOIN ev
  ON ev.pattern_id = w.pattern_id
  AND CAST(ev.day AS DATE) BETWEEN w.start_day AND w.end_day
GROUP BY w.pattern_id, w.start_day, w.end_day;
