-- Output: J3 record keys + packet inputs — one row per session, carrying the
--   session digest (docs/architecture/llm.md J3): client/entity/auditor,
--   integrity flags, per-turn one-liners (turn #, gap, typed prefix trimmed to
--   200 chars, tool-family sequence with match marks, J2 friction labels —
--   enrich.j2_verdicts exists even before J2 ran, empty), final-turn facts and
--   the full assistant tail of the last turn. Consumed by s3_enrich/runner.ts.
SELECT
  s.session_id,
  s.resumed_fragment,
  CAST(to_json(s.missing_turns) AS VARCHAR) AS missing_turns_json,
  s.client,
  s.entity,
  s.auditor,
  s.turn_count,
  s.final_turn_tool_count,
  s.final_turn_error_count,
  d.turns_json,
  d.final_assistant_tail
FROM derive.sessions s
JOIN (
  SELECT
    t.session_id,
    CAST(to_json(list(struct_pack(
      turn_number := t.turn_number,
      gap_before_s := t.gap_before_s,
      -- The HUMAN-AUTHORED portion only (empty when the whole message is
      -- harness-injected — the markers below say what was injected); showing
      -- raw user_content head here would present skill bodies as typed text.
      typed_prefix := substr(ct.user_content, 1, LEAST(t.typed_prefix_chars, 200)),
      has_task_notification := t.has_task_notification,
      has_skill_body := t.has_skill_body,
      has_extract_paste := t.has_extract_paste,
      platform_limit_marker := t.platform_limit_marker,
      assistant_tail := right(ct.assistant_content, 500),
      tool_families := COALESCE(te.families, []),
      matched_patterns := COALESCE(te.patterns, []),
      friction := j2.turn_friction,
      friction_cause := j2.friction_cause
    ) ORDER BY t.turn_number)) AS VARCHAR) AS turns_json,
    arg_max(right(ct.assistant_content, 1000), t.turn_number) AS final_assistant_tail
  FROM derive.turns t
  JOIN clean.turns ct USING (trace_id)
  LEFT JOIN (
    SELECT
      trace_id,
      list(tool_family ORDER BY seq_index) AS families,
      list(matched_signature_id ORDER BY seq_index)
        FILTER (WHERE matched_signature_id IS NOT NULL) AS patterns
    FROM derive.tool_events
    GROUP BY trace_id
  ) te USING (trace_id)
  LEFT JOIN enrich.j2_verdicts j2 USING (trace_id)
  GROUP BY t.session_id
) d USING (session_id)
ORDER BY s.session_id;
