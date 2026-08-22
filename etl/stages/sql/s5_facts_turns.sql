-- Output: publish.facts_turns → facts/turns/day=<date>.parquet (fact plane,
--   partitioned by event date; per-day export in s5_publish.ts finalize()).
-- Columns (contracts TurnRowSchema, names exact): every filter dimension
--   denormalized (session_id, day, client, entity, auditor, is_demo_traffic,
--   job_type — pushed down from the session, a deliberate cross-half
--   dependency), turn_number, ts, gap_before_s, marker flags,
--   typed_prefix_chars, user/assistant_chars, tool_count, error_count,
--   max_same_tool_run, identical_input_chain_count, platform_limit_marker,
--   short_typed_after_short_gap, is_correction/turn_friction/friction_cause/
--   linked_failure_signature_id (enrichment; NULL-tolerant), user_text,
--   assistant_text (transcript — passes through verbatim from clean.turns:
--   stage-1-typed content, not a derived fact).
-- Publish-time renames made explicit (cross-track seam item 3): derive
--   `timestamp` → serve `ts` (ISO-8601 UTC VARCHAR); derived `day` partition
--   column added (UTC event date).
-- Window semantics: event-timestamp membership (ops side).
-- Contract: docs/architecture/etl.md Stage 5 fact plane; contracts/src/rows.ts.
CREATE TABLE publish.facts_turns AS
SELECT
  t.session_id,
  strftime(t.timestamp, '%Y-%m-%d') AS day,
  s.client,
  s.entity,
  s.auditor,
  s.is_demo_traffic,
  j3.job_type,
  t.turn_number,
  strftime(t.timestamp, '%Y-%m-%dT%H:%M:%S.%gZ') AS ts,
  t.gap_before_s,
  t.has_task_notification,
  t.has_skill_body,
  t.has_extract_paste,
  CAST(t.typed_prefix_chars AS INTEGER) AS typed_prefix_chars,
  CAST(t.user_chars AS INTEGER) AS user_chars,
  CAST(t.assistant_chars AS INTEGER) AS assistant_chars,
  CAST(t.tool_count AS INTEGER) AS tool_count,
  CAST(t.error_count AS INTEGER) AS error_count,
  CAST(t.max_same_tool_run AS INTEGER) AS max_same_tool_run,
  CAST(t.identical_input_chain_count AS INTEGER) AS identical_input_chain_count,
  t.platform_limit_marker,
  t.short_typed_after_short_gap,
  j2.is_correction,
  j2.turn_friction,
  j2.friction_cause,
  CASE WHEN j2.friction_cause = 'system_failure'
    THEN j2.linked_signature_pattern END AS linked_failure_signature_id,
  COALESCE(ct.user_content, '') AS user_text,
  COALESCE(ct.assistant_content, '') AS assistant_text
FROM derive.turns t
JOIN derive.sessions s USING (session_id)
LEFT JOIN clean.turns ct USING (trace_id)
LEFT JOIN enrich.j2_verdicts j2 USING (trace_id)
LEFT JOIN enrich.j3_verdicts j3 ON j3.session_id = t.session_id;
