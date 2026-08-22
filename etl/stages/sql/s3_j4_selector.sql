-- Output: J4 record keys + packet inputs — one row per curated capability-gap
--   cluster (_gap_rules temp table, installed by the job's prepare()) that has
--   at least one member session. Membership mirrors the deterministic
--   s4_gap_sessions detectors exactly (stage-2 facts only — J4 runs BEFORE
--   stage 4). candidate_session_ids is the post-hoc validation set for the
--   exemplar-⊆-input check. Consumed by s3_enrich/runner.ts.
WITH per_sess AS (
  SELECT
    session_id,
    COUNT(CASE WHEN tool_family = 'browser' THEN 1 END) AS browser_calls,
    COUNT(DISTINCT CASE WHEN tool_family = 'browser' THEN trace_id END) AS browser_turns,
    COUNT(CASE WHEN tool_family = 'subagent' THEN 1 END) AS subagent_calls,
    COUNT(DISTINCT CASE WHEN tool_family = 'subagent' THEN trace_id END) AS subagent_turns,
    COUNT(*) AS total_calls
  FROM derive.tool_events
  GROUP BY session_id
),
marks AS (
  SELECT
    session_id,
    COUNT(CASE WHEN has_extract_paste THEN 1 END) AS extract_turns
  FROM derive.turns
  GROUP BY session_id
),
members AS (
  SELECT g.gap_id, g.evidence_pattern, p.session_id, p.browser_turns AS workaround_turns
  FROM _gap_rules g
  JOIN per_sess p
    ON g.evidence_pattern = 'browser_call_concentration'
    AND p.browser_calls >= g.min_calls
    AND p.browser_calls * 1.0 / p.total_calls >= COALESCE(g.min_share, 0)
  UNION ALL
  SELECT g.gap_id, g.evidence_pattern, m.session_id, m.extract_turns
  FROM _gap_rules g
  JOIN marks m
    ON g.evidence_pattern = 'extract_paste_turns' AND m.extract_turns >= g.min_calls
  UNION ALL
  SELECT g.gap_id, g.evidence_pattern, p.session_id, p.subagent_turns
  FROM _gap_rules g
  JOIN per_sess p
    ON g.evidence_pattern = 'subagent_orchestration' AND p.subagent_calls >= g.min_calls
)
SELECT
  gap_id,
  ANY_VALUE(evidence_pattern) AS evidence_pattern,
  CAST(to_json(list(session_id ORDER BY session_id)) AS VARCHAR) AS candidate_session_ids_json,
  CAST(to_json(list(struct_pack(session_id := session_id, workaround_turns := workaround_turns)
               ORDER BY session_id)) AS VARCHAR) AS members_json
FROM members
GROUP BY gap_id
ORDER BY gap_id;
