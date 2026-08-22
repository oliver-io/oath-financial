-- Output: agg.incidents — temporal clusters of failures.
-- Columns (derivations.md §6): incident_id (pattern_id || ':' || start_day —
--   data-derived, stable across re-runs, never a per-run sequence),
--   signature_ids (LIST; single-signature windows in this detector),
--   start_ts, end_ts (min/max event ts inside the excursion window),
--   blast_sessions, blast_auditors, blast_clients, linked_friction_cost
--   (model rollup: sum of J2 turn_friction where the turn's friction_cause is
--   system_failure, its linked_signature_pattern is this incident's signature
--   (non-dangling), and the turn's timestamp falls inside the excursion window
--   — J2's own attribution does the linking, never co-occurrence alone; NULL
--   when J2 did not run or no attributed turns fall in the window).
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
),
friction AS (
  SELECT
    j2.linked_signature_pattern AS pattern_id,
    CAST(strftime(t.timestamp, '%Y-%m-%d') AS DATE) AS day,
    j2.turn_friction
  FROM enrich.j2_verdicts j2
  JOIN derive.turns t
    ON t.session_id = j2.session_id AND t.turn_number = j2.turn_number
  WHERE j2.verdict = 'ok'
    AND j2.friction_cause = 'system_failure'
    AND j2.linked_signature_pattern IS NOT NULL
    AND NOT COALESCE(j2.dangling_signature_flag, FALSE)
    AND j2.turn_friction IS NOT NULL
)
SELECT
  w.pattern_id || ':' || strftime(w.start_day, '%Y-%m-%d') AS incident_id,
  [w.pattern_id] AS signature_ids,
  MIN(ev.timestamp) AS start_ts,
  MAX(ev.timestamp) AS end_ts,
  COUNT(DISTINCT ev.session_id) AS blast_sessions,
  COUNT(DISTINCT ev.auditor) AS blast_auditors,
  COUNT(DISTINCT ev.client) AS blast_clients,
  (SELECT SUM(f.turn_friction)
   FROM friction f
   WHERE f.pattern_id = w.pattern_id
     AND f.day BETWEEN w.start_day AND w.end_day) AS linked_friction_cost
FROM win w
JOIN ev
  ON ev.pattern_id = w.pattern_id
  AND CAST(ev.day AS DATE) BETWEEN w.start_day AND w.end_day
GROUP BY w.pattern_id, w.start_day, w.end_day;
