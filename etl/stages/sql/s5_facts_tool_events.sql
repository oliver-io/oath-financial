-- Output: publish.facts_tool_events → facts/tool_events/day=<date>.parquet
--   (fact plane, partitioned by event date; per-day export in finalize()).
-- Columns (contracts ToolEventRowSchema, names exact): denormalized dims
--   (session_id, day, client, entity, auditor, is_demo_traffic, job_type),
--   turn_number, ts, seq_index, tool_name, tool_family, is_agent_tool,
--   matched_signature_id, matched_snippet (computed in stage 2 — ± radius
--   chars around the match, evidence popovers), rule_version (signatures.yaml
--   version when matched, else NULL), failure_verdict (merged provenance
--   verdict from agg.failure_verdicts), post_failure_shape,
--   repeat_of_seq_index.
-- Publish-time renames made explicit (cross-track seam item 3): derive
--   `timestamp` → serve `ts`; derive `repeat_of` (observation_id FK) → serve
--   `repeat_of_seq_index` (the earlier call's seq_index, self-join); derived
--   `day` partition column added.
-- Contract: docs/architecture/etl.md Stage 5 fact plane; contracts/src/rows.ts.
CREATE TABLE publish.facts_tool_events AS
SELECT
  e.session_id,
  strftime(e.timestamp, '%Y-%m-%d') AS day,
  s.client,
  s.entity,
  s.auditor,
  s.is_demo_traffic,
  j3.job_type,
  e.turn_number,
  strftime(e.timestamp, '%Y-%m-%dT%H:%M:%S.%gZ') AS ts,
  CAST(e.seq_index AS INTEGER) AS seq_index,
  e.tool_name,
  e.tool_family,
  e.is_agent_tool,
  e.matched_signature_id,
  e.matched_snippet,
  CASE WHEN e.matched_signature_id IS NOT NULL
    THEN CAST(getvariable('signatures_version') AS VARCHAR) END AS rule_version,
  v.failure_verdict,
  e.post_failure_shape,
  CAST(r.seq_index AS INTEGER) AS repeat_of_seq_index
FROM derive.tool_events e
JOIN derive.sessions s USING (session_id)
JOIN agg.failure_verdicts v USING (tool_event_id)
LEFT JOIN derive.tool_events r ON r.observation_id = e.repeat_of AND r.trace_id = e.trace_id
LEFT JOIN enrich.j3_verdicts j3 ON j3.session_id = e.session_id;
