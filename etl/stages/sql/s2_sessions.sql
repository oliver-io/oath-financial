-- Output: derive.sessions — deterministic session facts (one per session).
-- Columns (derivations.md §3, names exact): session_id, turn_count, first_ts,
--   last_ts (ISO-8601 UTC VARCHAR — the containment predicate's inputs),
--   wall_span_s, capped_gap_span_s (cap from thresholds.yaml via getvariable,
--   published alongside the cap value), bout_count, final_turn_tool_count,
--   final_turn_error_count, resumed_fragment, missing_turns, is_demo_traffic,
--   interaction_cost (turns with typed_prefix_chars > 0),
--   quick_restart_after_s (NOT a linkage — same auditor's next session start,
--   when under the window), plus client/entity/auditor dims for rollups.
-- Model-class fields (job_type, outcome, outcome_evidence, friction_share,
--   dominant_friction_cause, ended_mid_work) live in enrich.*, not here.
-- Contract: docs/architecture/etl.md Stage 2; derivations.md §3.
CREATE TABLE derive.sessions AS
WITH agg AS (
  SELECT
    session_id,
    COUNT(*) AS turn_count,
    MIN(timestamp) AS first_ts_t,
    MAX(timestamp) AS last_ts_t,
    epoch(MAX(timestamp) - MIN(timestamp)) AS wall_span_s,
    COALESCE(SUM(CASE
      WHEN gap_before_s >= 0 AND gap_before_s <= CAST(getvariable('gap_cap_s') AS DOUBLE)
        THEN gap_before_s ELSE 0 END), 0) AS capped_gap_span_s,
    1 + COALESCE(SUM(CASE
      WHEN gap_before_s > CAST(getvariable('gap_cap_s') AS DOUBLE) THEN 1 ELSE 0 END), 0)
      AS bout_count,
    COALESCE(SUM(CASE WHEN typed_prefix_chars > 0 THEN 1 ELSE 0 END), 0) AS interaction_cost
  FROM derive.turns
  GROUP BY session_id
),
fin AS (
  SELECT session_id, tool_count AS final_turn_tool_count, error_count AS final_turn_error_count
  FROM (
    SELECT
      session_id, tool_count, error_count,
      ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY turn_number DESC) AS rn
    FROM derive.turns
  )
  WHERE rn = 1
),
meta AS (
  SELECT
    session_id,
    ANY_VALUE(resumed_fragment) AS resumed_fragment,
    ANY_VALUE(missing_turns) AS missing_turns,
    ANY_VALUE(is_demo_traffic) AS is_demo_traffic,
    ANY_VALUE(client) AS client,
    ANY_VALUE(entity) AS entity,
    ANY_VALUE(linux_user) AS auditor,
    ANY_VALUE(auditor_email) AS auditor_email
  FROM clean.turns
  GROUP BY session_id
),
restart AS (
  SELECT
    a.session_id,
    epoch(LEAD(a.first_ts_t) OVER (PARTITION BY m.auditor ORDER BY a.first_ts_t) - a.last_ts_t)
      AS next_start_gap_s
  FROM agg a
  JOIN meta m USING (session_id)
)
SELECT
  a.session_id,
  a.turn_count,
  strftime(a.first_ts_t, '%Y-%m-%dT%H:%M:%S.%gZ') AS first_ts,
  strftime(a.last_ts_t, '%Y-%m-%dT%H:%M:%S.%gZ') AS last_ts,
  a.wall_span_s,
  a.capped_gap_span_s,
  a.bout_count,
  f.final_turn_tool_count,
  f.final_turn_error_count,
  m.resumed_fragment,
  m.missing_turns,
  m.is_demo_traffic,
  a.interaction_cost,
  CASE
    WHEN r.next_start_gap_s >= 0
     AND r.next_start_gap_s < CAST(getvariable('quick_restart_window_s') AS DOUBLE)
      THEN r.next_start_gap_s
  END AS quick_restart_after_s,
  m.client,
  m.entity,
  m.auditor,
  m.auditor_email
FROM agg a
JOIN fin f USING (session_id)
JOIN meta m USING (session_id)
JOIN restart r USING (session_id);
