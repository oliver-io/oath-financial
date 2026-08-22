-- Output: agg.gap_sessions — capability_gap ↔ session membership, computed
-- deterministically from the curated cluster rules (_gap_rules, prepare()).
-- Columns: gap_id, session_id, workaround_turns (turns spent inside the
--   workaround — the interaction_cost_estimate input).
-- Detectors (findings.yaml capability_gaps, derivations.md §7
--   evidence_pattern): browser_call_concentration (calls >= min_calls AND
--   share >= min_share), extract_paste_turns (marker turns >= min_calls),
--   subagent_orchestration (subagent calls >= min_calls). Enrichment (J4)
--   only names/groups gaps — never selects or counts.
-- Contract: docs/architecture/etl.md Stage 4; derivations.md §7.
CREATE TABLE agg.gap_sessions AS
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
)
SELECT g.gap_id, p.session_id, p.browser_turns AS workaround_turns
FROM _gap_rules g
JOIN per_sess p
  ON g.evidence_pattern = 'browser_call_concentration'
  AND p.browser_calls >= g.min_calls
  AND p.browser_calls * 1.0 / p.total_calls >= COALESCE(g.min_share, 0)
UNION ALL
SELECT g.gap_id, m.session_id, m.extract_turns
FROM _gap_rules g
JOIN marks m
  ON g.evidence_pattern = 'extract_paste_turns' AND m.extract_turns >= g.min_calls
UNION ALL
SELECT g.gap_id, p.session_id, p.subagent_turns
FROM _gap_rules g
JOIN per_sess p
  ON g.evidence_pattern = 'subagent_orchestration' AND p.subagent_calls >= g.min_calls;
