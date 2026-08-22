-- Output: derive.tool_events — one row per tool invocation (TOOL observation).
-- Columns (derivations.md §1, names exact): tool_event_id, observation_id,
--   trace_id, session_id, turn_number, timestamp, tool_name, tool_family,
--   seq_index, matched_signature_id (anchored match only — NEVER bare
--   substring; amounts collide with 403), counts_as_failure
--   (true|false|uncertain as VARCHAR, curated join), match_index,
--   post_failure_shape (same_tool_clean_later | other_calls_after |
--   turn_ends_on_failure | NULL), repeat_of (byte-identical earlier input in
--   same turn), matched_snippet (± radius chars from thresholds.yaml around
--   the match — the fact serving's evidence popovers publish; computed here
--   because output text does not leave stage 1), is_agent_tool,
--   j1_candidate (gray-zone selector:
--   counts_as_failure = uncertain), j5_sample_bucket
--   (unmatched|matched|NULL — seeded deterministic samples, seed from
--   thresholds.yaml via getvariable, sizes N/M likewise).
-- Rules arrive as temp tables from prepare(): _sig_matches (one chosen match
--   per event, tool_scope/target applied), _tool_families.
-- Contract: docs/architecture/etl.md Stage 2; derivations.md §1.
CREATE TABLE derive.tool_events AS
WITH ev AS (
  SELECT
    o.observation_id,
    o.trace_id,
    t.session_id,
    t.turn_number,
    t.timestamp,
    o.tool_name,
    COALESCE(f.family, 'other') AS tool_family,
    ROW_NUMBER() OVER (
      PARTITION BY o.trace_id
      ORDER BY o.obs_index NULLS LAST, o.observation_id
    ) AS seq_index,
    o.input,
    (o.output_text IS NOT NULL) AS has_output,
    m.pattern_id AS matched_signature_id,
    m.counts_as_failure,
    m.match_index,
    CASE WHEN m.pattern_id IS NOT NULL THEN substr(
      o.output_text,
      GREATEST(1, m.match_index + 1 - CAST(getvariable('matched_snippet_radius_chars') AS INTEGER)),
      2 * CAST(getvariable('matched_snippet_radius_chars') AS INTEGER)
    ) END AS matched_snippet,
    (COALESCE(f.family, 'other') = 'subagent') AS is_agent_tool
  FROM clean.observations o
  JOIN clean.turns t ON t.trace_id = o.trace_id
  LEFT JOIN _sig_matches m ON m.observation_id = o.observation_id
  LEFT JOIN _tool_families f ON f.tool_name = o.tool_name
  WHERE o.type = 'TOOL'
),
shaped AS (
  SELECT
    *,
    SUM(CASE WHEN matched_signature_id IS NULL THEN 1 ELSE 0 END) OVER (
      PARTITION BY trace_id, tool_name
      ORDER BY seq_index
      ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
    ) AS same_tool_clean_after,
    COUNT(*) OVER (
      PARTITION BY trace_id
      ORDER BY seq_index
      ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
    ) AS calls_after,
    CASE
      WHEN input IS NULL THEN NULL
      WHEN ROW_NUMBER() OVER (PARTITION BY trace_id, input ORDER BY seq_index) > 1
        THEN FIRST_VALUE(observation_id) OVER (PARTITION BY trace_id, input ORDER BY seq_index)
    END AS repeat_of
  FROM ev
),
sampled AS (
  -- J5 samples only auditable outputs: a NULL output cannot answer either
  -- audit question (missing outputs are already a structural flag), so the
  -- fixed N/M budgets rank over rows that HAVE text.
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY CASE
        WHEN NOT has_output THEN 'no_output'
        WHEN matched_signature_id IS NULL THEN 'unmatched'
        ELSE 'matched'
      END
      ORDER BY hash(concat(CAST(getvariable('j5_seed') AS VARCHAR), observation_id)), observation_id
    ) AS j5_rank
  FROM shaped
)
SELECT
  observation_id AS tool_event_id,
  observation_id,
  trace_id,
  session_id,
  turn_number,
  timestamp,
  tool_name,
  tool_family,
  seq_index,
  matched_signature_id,
  counts_as_failure,
  match_index,
  matched_snippet,
  CASE
    WHEN matched_signature_id IS NULL THEN NULL
    WHEN COALESCE(same_tool_clean_after, 0) > 0 THEN 'same_tool_clean_later'
    WHEN calls_after > 0 THEN 'other_calls_after'
    ELSE 'turn_ends_on_failure'
  END AS post_failure_shape,
  repeat_of,
  is_agent_tool,
  (counts_as_failure = 'uncertain') AS j1_candidate,
  CASE
    WHEN has_output AND matched_signature_id IS NULL
      AND j5_rank <= CAST(getvariable('j5_unmatched_n') AS BIGINT) THEN 'unmatched'
    WHEN has_output AND matched_signature_id IS NOT NULL
      AND j5_rank <= CAST(getvariable('j5_matched_m') AS BIGINT) THEN 'matched'
  END AS j5_sample_bucket
FROM sampled;
