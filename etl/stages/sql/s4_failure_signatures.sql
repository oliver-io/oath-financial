-- Output: agg.failure_signatures — one row per rule-file pattern (zero-match
-- patterns keep a row: pattern_id is the stable public key).
-- Columns (derivations.md §5, names exact): pattern_id, display_name,
--   signature_class, counts_as_failure (tri-state VARCHAR), event_count,
--   session_count, auditor_count, client_count, first_seen, last_seen
--   (TIMESTAMPTZ; stage 5 formats), series_start_day, daily_series (INT LIST
--   from series_start_day, one entry per day; stage 5 JSON-encodes),
--   terminal_rate (share of occurrences in a session's final turn — a
--   co-occurrence rate, "kills work" is interpretation),
--   shape_same_tool_clean_later / shape_other_calls_after /
--   shape_turn_ends_on_failure (structural distribution as counts),
--   j5_false_positive_rate, j5_missed_rate (NULL until J5/M4).
-- Rules arrive as _signature_rules (prepare()).
-- Contract: docs/architecture/etl.md Stage 4; derivations.md §5.
CREATE TABLE agg.failure_signatures AS
WITH final_turns AS (
  SELECT session_id, MAX(turn_number) AS final_turn
  FROM derive.turns
  GROUP BY session_id
),
ev AS (
  SELECT
    e.matched_signature_id AS pattern_id,
    e.timestamp,
    strftime(e.timestamp, '%Y-%m-%d') AS day,
    e.session_id,
    s.auditor,
    s.client,
    e.post_failure_shape,
    (e.turn_number = ft.final_turn) AS is_terminal
  FROM derive.tool_events e
  JOIN derive.sessions s USING (session_id)
  JOIN final_turns ft USING (session_id)
  WHERE e.matched_signature_id IS NOT NULL
),
per_sig AS (
  SELECT
    pattern_id,
    COUNT(*) AS event_count,
    COUNT(DISTINCT session_id) AS session_count,
    COUNT(DISTINCT auditor) AS auditor_count,
    COUNT(DISTINCT client) AS client_count,
    MIN(timestamp) AS first_seen,
    MAX(timestamp) AS last_seen,
    MIN(day) AS series_start_day,
    MAX(day) AS series_end_day,
    AVG(CASE WHEN is_terminal THEN 1.0 ELSE 0.0 END) AS terminal_rate,
    SUM(CASE WHEN post_failure_shape = 'same_tool_clean_later' THEN 1 ELSE 0 END)
      AS shape_same_tool_clean_later,
    SUM(CASE WHEN post_failure_shape = 'other_calls_after' THEN 1 ELSE 0 END)
      AS shape_other_calls_after,
    SUM(CASE WHEN post_failure_shape = 'turn_ends_on_failure' THEN 1 ELSE 0 END)
      AS shape_turn_ends_on_failure
  FROM ev
  GROUP BY pattern_id
),
daily AS (
  SELECT pattern_id, day, COUNT(*) AS n FROM ev GROUP BY pattern_id, day
),
span_days AS (
  SELECT
    p.pattern_id,
    unnest(generate_series(
      CAST(p.series_start_day AS DATE),
      CAST(p.series_end_day AS DATE),
      INTERVAL 1 DAY
    )) AS d
  FROM per_sig p
),
series AS (
  SELECT
    sd.pattern_id,
    list(COALESCE(dl.n, 0) ORDER BY sd.d) AS daily_series
  FROM span_days sd
  LEFT JOIN daily dl
    ON dl.pattern_id = sd.pattern_id AND dl.day = strftime(sd.d, '%Y-%m-%d')
  GROUP BY sd.pattern_id
)
SELECT
  r.pattern_id,
  r.display_name,
  r.signature_class,
  r.counts_as_failure,
  COALESCE(p.event_count, 0) AS event_count,
  COALESCE(p.session_count, 0) AS session_count,
  COALESCE(p.auditor_count, 0) AS auditor_count,
  COALESCE(p.client_count, 0) AS client_count,
  p.first_seen,
  p.last_seen,
  p.series_start_day,
  COALESCE(se.daily_series, []) AS daily_series,
  p.terminal_rate,
  COALESCE(p.shape_same_tool_clean_later, 0) AS shape_same_tool_clean_later,
  COALESCE(p.shape_other_calls_after, 0) AS shape_other_calls_after,
  COALESCE(p.shape_turn_ends_on_failure, 0) AS shape_turn_ends_on_failure,
  CAST(NULL AS DOUBLE) AS j5_false_positive_rate,
  CAST(NULL AS DOUBLE) AS j5_missed_rate
FROM _signature_rules r
LEFT JOIN per_sig p USING (pattern_id)
LEFT JOIN series se USING (pattern_id)
ORDER BY r.rule_order;
