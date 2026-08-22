-- Output: clean.turns — typed, flagged turns (one row per trace).
-- Columns: trace_id, session_id, turn_number, timestamp (TIMESTAMPTZ), client,
--   entity, linux_user, auditor_email, user_content, assistant_content,
--   observation_ids, is_demo_traffic (client = tealstone OR user = demo — NOT
--   the same set), resumed_fragment, missing_turns, output_missing.
-- Gates: pre — referential (observations.traceId ⊆ traces.id; observation id
--   lists consistent); post — FORK gate: overlapping turn-number ranges per
--   (auditor, client) → ABORT the run (exit 2).
-- Contract: docs/architecture/etl.md Stage 1; derivations.md §3 integrity flags.
CREATE TABLE clean.turns AS
WITH base AS (
  SELECT
    id AS trace_id,
    json_extract_string(metadata, '$.session_id') AS session_id,
    CAST(json_extract_string(metadata, '$.turn_number') AS INTEGER) AS turn_number,
    CAST(timestamp AS TIMESTAMPTZ) AS timestamp,
    json_extract_string(metadata, '$.client') AS client,
    json_extract_string(metadata, '$.entity') AS entity,
    json_extract_string(metadata, '$.linux_user') AS linux_user,
    json_extract_string(metadata, '$.auditor_email') AS auditor_email,
    json_extract_string(input, '$.content') AS user_content,
    json_extract_string(output, '$.content') AS assistant_content,
    observations AS observation_ids,
    (output IS NULL OR json_type(output) = 'NULL') AS output_missing
  FROM raw.traces
),
sess AS (
  SELECT
    session_id,
    MIN(turn_number) AS min_turn,
    MAX(turn_number) AS max_turn,
    list_sort(list(turn_number)) AS turn_list
  FROM base
  GROUP BY session_id
),
sess_flags AS (
  SELECT
    session_id,
    (min_turn > 1) AS resumed_fragment,
    list_filter(
      generate_series(min_turn, max_turn),
      x -> NOT list_contains(turn_list, x)
    ) AS missing_turns
  FROM sess
)
SELECT
  b.trace_id,
  b.session_id,
  b.turn_number,
  b.timestamp,
  b.client,
  b.entity,
  b.linux_user,
  b.auditor_email,
  b.user_content,
  b.assistant_content,
  b.observation_ids,
  (b.client = 'tealstone' OR b.linux_user = 'demo') AS is_demo_traffic,
  f.resumed_fragment,
  f.missing_turns,
  b.output_missing
FROM base b
JOIN sess_flags f USING (session_id);
