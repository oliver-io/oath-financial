-- Output: clean.observations — typed observations, metadata flattened.
-- Columns: observation_id, trace_id, type (TOOL|GENERATION|SPAN), name,
--   tool_name, tool_id, tool_count, parent_observation_id, input, output,
--   output_text (the unwrapped text form signature matching reads: a JSON
--   string output unwraps to its value; any other JSON serializes verbatim),
--   output_missing (42 rows), usage_missing (49 GENERATION rows),
--   obs_index (position in the owning trace's observations list — the
--   within-turn tool-sequence order, seq_index's input).
-- Gates: inherited from stage (see s1_turns.sql).
-- Contract: docs/architecture/etl.md Stage 1.
CREATE TABLE clean.observations AS
SELECT
  o.id AS observation_id,
  o.traceId AS trace_id,
  o.type,
  o.name,
  json_extract_string(o.metadata, '$.tool_name') AS tool_name,
  json_extract_string(o.metadata, '$.tool_id') AS tool_id,
  CAST(json_extract_string(o.metadata, '$.tool_count') AS INTEGER) AS tool_count,
  o.parentObservationId AS parent_observation_id,
  CAST(o.input AS VARCHAR) AS input,
  CAST(o.output AS VARCHAR) AS output,
  CASE
    WHEN o.output IS NULL OR json_type(o.output) = 'NULL' THEN NULL
    WHEN json_type(o.output) = 'VARCHAR' THEN json_extract_string(o.output, '$')
    ELSE CAST(o.output AS VARCHAR)
  END AS output_text,
  (o.output IS NULL OR json_type(o.output) = 'NULL') AS output_missing,
  (
    o.type = 'GENERATION'
    AND (o.usageDetails IS NULL OR json_type(o.usageDetails) = 'NULL')
    AND (o.usage IS NULL OR json_type(o.usage) = 'NULL')
  ) AS usage_missing,
  list_position(t.observations, o.id) AS obs_index
FROM raw.observations o
LEFT JOIN raw.traces t ON t.id = o.traceId;
