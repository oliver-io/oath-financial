-- Output: J1 record keys + packet inputs — one row per gray-zone tool_event
--   (derive.tool_events.j1_candidate: signature matched with
--   counts_as_failure = uncertain). Packet inputs per docs/architecture/llm.md
--   J1: the matched snippet + raw output head, position in the turn's tool
--   sequence, the two following tool calls (names + match status), and the
--   turn's assistant-text tail. Consumed by s3_enrich/runner.ts.
SELECT
  c.tool_event_id,
  c.observation_id,
  c.trace_id,
  c.session_id,
  c.turn_number,
  c.tool_name,
  c.matched_signature_id,
  c.seq_index,
  c.matched_snippet,
  substr(o.output_text, 1, 600) AS output_text,
  c.following_tools_json,
  right(ct.assistant_content, 500) AS assistant_tail
FROM (
  SELECT
    e.*,
    CAST(to_json(list_filter(
      [
        struct_pack(tool_name := LEAD(e.tool_name, 1) OVER w,
                    matched := LEAD(e.matched_signature_id, 1) OVER w IS NOT NULL),
        struct_pack(tool_name := LEAD(e.tool_name, 2) OVER w,
                    matched := LEAD(e.matched_signature_id, 2) OVER w IS NOT NULL)
      ],
      x -> x.tool_name IS NOT NULL
    )) AS VARCHAR) AS following_tools_json
  FROM derive.tool_events e
  WINDOW w AS (PARTITION BY e.trace_id ORDER BY e.seq_index)
) c
JOIN clean.observations o USING (observation_id)
JOIN clean.turns ct ON ct.trace_id = c.trace_id
WHERE c.j1_candidate
ORDER BY c.session_id, c.turn_number, c.seq_index, c.observation_id;
