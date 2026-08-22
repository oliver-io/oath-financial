-- Output: derive.turns — row-level turn facts (one row per trace).
-- Columns (derivations.md §2, names exact): trace_id, session_id, turn_number,
--   timestamp, gap_before_s (NULL on first turns — the only real time signal),
--   has_task_notification, has_skill_body, has_extract_paste (independent
--   marker flags — NOT an exclusive origin enum), typed_prefix_chars,
--   user_chars, assistant_chars, tool_count, error_count (failure-counting
--   matches, Agent tool excluded by default), max_same_tool_run,
--   identical_input_chain_count, platform_limit_marker,
--   short_typed_after_short_gap (J2 correction candidate flag; thresholds via
--   getvariable from thresholds.yaml).
-- Marker flags/typed prefix arrive via the _turn_marks temp table (prepare()).
-- Model-class fields (is_correction, turn_friction, friction_cause,
--   linked_failure_signature_id) live in enrich.*, not here.
-- Contract: docs/architecture/etl.md Stage 2; derivations.md §2.
CREATE TABLE derive.turns AS
WITH ev_agg AS (
  SELECT
    trace_id,
    COUNT(*) AS tool_count,
    SUM(CASE WHEN counts_as_failure = 'true' AND NOT is_agent_tool THEN 1 ELSE 0 END) AS error_count,
    COUNT(DISTINCT repeat_of) AS identical_input_chain_count
  FROM derive.tool_events
  GROUP BY trace_id
),
runs AS (
  SELECT trace_id, MAX(run_len) AS max_same_tool_run
  FROM (
    SELECT trace_id, tool_name, grp, COUNT(*) AS run_len
    FROM (
      SELECT
        trace_id,
        tool_name,
        seq_index - ROW_NUMBER() OVER (PARTITION BY trace_id, tool_name ORDER BY seq_index) AS grp
      FROM derive.tool_events
    )
    GROUP BY trace_id, tool_name, grp
  )
  GROUP BY trace_id
),
gapped AS (
  SELECT
    t.trace_id,
    t.session_id,
    t.turn_number,
    t.timestamp,
    epoch(t.timestamp - LAG(t.timestamp) OVER (
      PARTITION BY t.session_id ORDER BY t.turn_number
    )) AS gap_before_s,
    t.user_content,
    t.assistant_content
  FROM clean.turns t
)
SELECT
  g.trace_id,
  g.session_id,
  g.turn_number,
  g.timestamp,
  g.gap_before_s,
  COALESCE(mk.has_task_notification, FALSE) AS has_task_notification,
  COALESCE(mk.has_skill_body, FALSE) AS has_skill_body,
  COALESCE(mk.has_extract_paste, FALSE) AS has_extract_paste,
  COALESCE(mk.typed_prefix_chars, 0) AS typed_prefix_chars,
  COALESCE(length(g.user_content), 0) AS user_chars,
  COALESCE(length(g.assistant_content), 0) AS assistant_chars,
  COALESCE(ev.tool_count, 0) AS tool_count,
  COALESCE(ev.error_count, 0) AS error_count,
  COALESCE(r.max_same_tool_run, 0) AS max_same_tool_run,
  COALESCE(ev.identical_input_chain_count, 0) AS identical_input_chain_count,
  COALESCE(mk.platform_limit_marker, FALSE) AS platform_limit_marker,
  (
    COALESCE(mk.typed_prefix_chars, 0) > 0
    AND COALESCE(mk.typed_prefix_chars, 0) <= CAST(getvariable('cc_max_typed_chars') AS BIGINT)
    AND g.gap_before_s IS NOT NULL
    AND g.gap_before_s >= 0
    AND g.gap_before_s <= CAST(getvariable('cc_max_gap_s') AS DOUBLE)
  ) AS short_typed_after_short_gap
FROM gapped g
LEFT JOIN _turn_marks mk ON mk.trace_id = g.trace_id
LEFT JOIN ev_agg ev ON ev.trace_id = g.trace_id
LEFT JOIN runs r ON r.trace_id = g.trace_id;
