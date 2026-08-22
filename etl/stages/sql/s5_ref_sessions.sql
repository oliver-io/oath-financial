-- Output: publish.ref_sessions → ref/sessions.parquet — reference plane,
--   global, fetched whole.
-- Columns (contracts SessionRowSchema, names exact): all derive.sessions
--   facts + outcome (FULL five-state enum: completed | abandoned |
--   undetermined | unclassified | NULL — unclassified = enrichment
--   abstention/error; NULL = job not run; the UI renders all three
--   differently — the pipeline states are appended HERE at publish, they are
--   not model judgments), outcome_evidence, job_type, job_type_secondary,
--   ended_mid_work, friction_share (J2 rollup), dominant_friction_cause,
--   dominant_linked_signature (session-grain crossover chip: the most
--   frequent failure-counting signature in the session), integrity flags,
--   first_ts/last_ts (the containment predicate's inputs), missing_turns as
--   JSON-encoded TEXT (contracts convention).
-- Contract: docs/architecture/etl.md Stage 5 reference plane; contracts/src/rows.ts.
CREATE TABLE publish.ref_sessions AS
WITH dom AS (
  SELECT
    e.session_id,
    e.matched_signature_id AS sig,
    ROW_NUMBER() OVER (
      PARTITION BY e.session_id ORDER BY COUNT(*) DESC, e.matched_signature_id
    ) AS rn
  FROM derive.tool_events e
  JOIN agg.failure_verdicts v USING (tool_event_id)
  WHERE v.failure_verdict IN ('rule', 'model_added')
  GROUP BY e.session_id, e.matched_signature_id
),
fr AS (
  SELECT
    t.session_id,
    AVG(j2.turn_friction) AS friction_share,
    mode(j2.friction_cause) AS dominant_friction_cause
  FROM derive.turns t
  JOIN enrich.j2_turns j2 USING (trace_id)
  GROUP BY t.session_id
)
SELECT
  s.session_id,
  s.client,
  s.entity,
  s.auditor,
  s.is_demo_traffic,
  CAST(s.turn_count AS INTEGER) AS turn_count,
  s.first_ts,
  s.last_ts,
  s.wall_span_s,
  s.capped_gap_span_s,
  CAST(s.bout_count AS INTEGER) AS bout_count,
  CAST(s.final_turn_tool_count AS INTEGER) AS final_turn_tool_count,
  CAST(s.final_turn_error_count AS INTEGER) AS final_turn_error_count,
  s.resumed_fragment,
  CAST(to_json(s.missing_turns) AS VARCHAR) AS missing_turns,
  CAST(s.interaction_cost AS INTEGER) AS interaction_cost,
  s.quick_restart_after_s,
  j3.job_type,
  j3.job_type_secondary,
  CASE
    WHEN j3.session_id IS NULL THEN NULL
    WHEN j3.verdict IN ('insufficient', 'error') THEN 'unclassified'
    ELSE j3.outcome
  END AS outcome,
  j3.outcome_evidence,
  j3.ended_mid_work,
  fr.friction_share,
  fr.dominant_friction_cause,
  dom.sig AS dominant_linked_signature
FROM derive.sessions s
LEFT JOIN enrich.j3_sessions j3 USING (session_id)
LEFT JOIN fr USING (session_id)
LEFT JOIN dom ON dom.session_id = s.session_id AND dom.rn = 1;
