-- Output: J2 record keys + packet inputs — one row per turn (ALL turns: the
--   coverage denominator is the turn count; correction judgment applies only
--   to short_typed_after_short_gap candidates). Field-level truncation happens
--   HERE (packets.ts header): user text head, assistant head+tail, previous
--   turn's assistant tail (for the correction judgment), per-turn tool-family
--   sequence and the matched signature patterns (the post-hoc validation set
--   for linked_signature_pattern). Ordered by session so the runner's
--   per-session batches are contiguous. Consumed by s3_enrich/runner.ts.
SELECT
  t.trace_id,
  t.session_id,
  t.turn_number,
  -- Session-position facts (structural): the packet must tell the model when a
  -- turn is the session's first observed / final exchange — the classifier has
  -- no future beyond the row it is given, so "nothing follows" is a fact only
  -- the selector's whole-session view can assert.
  t.turn_number = MIN(t.turn_number) OVER (PARTITION BY t.session_id) AS is_first_turn,
  t.turn_number = MAX(t.turn_number) OVER (PARTITION BY t.session_id) AS is_final_turn,
  COUNT(*) OVER (PARTITION BY t.session_id) AS session_turn_count,
  s.resumed_fragment AS session_resumed_fragment,
  t.gap_before_s,
  t.has_task_notification,
  t.has_skill_body,
  t.has_extract_paste,
  t.typed_prefix_chars,
  t.platform_limit_marker,
  t.short_typed_after_short_gap,
  substr(ct.user_content, 1, 1500) AS user_text,
  substr(ct.assistant_content, 1, 1000) AS assistant_head,
  right(ct.assistant_content, 500) AS assistant_tail,
  right(
    LAG(ct.assistant_content) OVER (PARTITION BY t.session_id ORDER BY t.turn_number),
    500
  ) AS prev_assistant_tail,
  COALESCE(te.tool_families_json, '[]') AS tool_families_json,
  COALESCE(te.matched_patterns_json, '[]') AS matched_patterns_json
FROM derive.turns t
JOIN clean.turns ct USING (trace_id)
JOIN derive.sessions s ON s.session_id = t.session_id
LEFT JOIN (
  SELECT
    trace_id,
    CAST(to_json(list(tool_family ORDER BY seq_index)) AS VARCHAR) AS tool_families_json,
    CAST(to_json(list(matched_signature_id ORDER BY seq_index)
            FILTER (WHERE matched_signature_id IS NOT NULL)) AS VARCHAR) AS matched_patterns_json
  FROM derive.tool_events
  GROUP BY trace_id
) te USING (trace_id)
ORDER BY t.session_id, t.turn_number;
