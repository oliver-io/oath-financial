-- Output: publish.ref_findings → ref/findings.parquet — the landing-page
--   cards, built by versioned threshold rules from rules/findings.yaml
--   (_finding_rules, prepare()).
-- Columns (contracts FindingRowSchema): finding_id, rank, audience, title
--   (rule-templated, never model prose), metric_value, metric_label,
--   sparkline (JSON TEXT), series_start_day, target_params (JSON TEXT),
--   provenance, requires_enrichment.
-- Gating: a card publishes only when its claim holds — signature has events,
--   and the known claim-param gates (min_sessions / min_auditors) pass; rows
--   with requires_enrichment=true are dropped when enrichment did not run
--   (they are exactly the non-degraded card set). Computable metrics (M4):
--   'event_count' (signature blast, agg.failure_signatures),
--   'linked_friction' (sum of J2 turn_friction attributed to the rule's
--   signature via linked_signature_pattern — model provenance; min_sessions
--   gates on distinct attributed sessions), and 'abandoned_session_count'
--   (J3 outcome='abandoned' judgments — model provenance; min_sessions gates
--   the count). Enrichment metrics publish only when enrichment ran AND rows
--   exist; their sparkline is empty (no honest daily series for judgments).
--   Other metric strings are future rules and simply do not publish.
-- Contract: docs/architecture/etl.md Stage 5 reference plane; contracts/src/rows.ts.
CREATE TABLE publish.ref_findings AS
SELECT
  f.finding_id,
  f.rank,
  f.audience,
  f.title,
  CAST(a.event_count AS DOUBLE) AS metric_value,
  'events' AS metric_label,
  CAST(to_json(a.daily_series) AS VARCHAR) AS sparkline,
  a.series_start_day,
  f.target_params_json AS target_params,
  f.provenance,
  f.requires_enrichment
FROM _finding_rules f
JOIN agg.failure_signatures a ON a.pattern_id = f.signature
WHERE f.metric = 'event_count'
  AND (NOT f.requires_enrichment OR CAST(getvariable('enrichment_ran') AS BOOLEAN))
  AND a.event_count > 0
  AND (f.min_sessions IS NULL OR a.session_count >= f.min_sessions)
  AND (f.min_auditors IS NULL OR a.auditor_count >= f.min_auditors)
UNION ALL
SELECT
  f.finding_id,
  f.rank,
  f.audience,
  f.title,
  CAST(x.total AS DOUBLE) AS metric_value,
  'friction points' AS metric_label,
  '[]' AS sparkline,
  CAST(NULL AS VARCHAR) AS series_start_day,
  f.target_params_json AS target_params,
  f.provenance,
  f.requires_enrichment
FROM _finding_rules f
JOIN (
  SELECT
    linked_signature_pattern AS signature,
    SUM(turn_friction) AS total,
    COUNT(DISTINCT session_id) AS session_count
  FROM enrich.j2_verdicts
  WHERE verdict = 'ok'
    AND friction_cause = 'system_failure'
    AND linked_signature_pattern IS NOT NULL
    AND NOT COALESCE(dangling_signature_flag, FALSE)
    AND turn_friction IS NOT NULL
  GROUP BY linked_signature_pattern
) x ON x.signature = f.signature
WHERE f.metric = 'linked_friction'
  AND CAST(getvariable('enrichment_ran') AS BOOLEAN)
  AND x.total > 0
  AND (f.min_sessions IS NULL OR x.session_count >= f.min_sessions)
UNION ALL
SELECT
  f.finding_id,
  f.rank,
  f.audience,
  f.title,
  CAST(x.n AS DOUBLE) AS metric_value,
  'sessions' AS metric_label,
  '[]' AS sparkline,
  CAST(NULL AS VARCHAR) AS series_start_day,
  f.target_params_json AS target_params,
  f.provenance,
  f.requires_enrichment
FROM _finding_rules f
CROSS JOIN (
  SELECT COUNT(*) AS n
  FROM enrich.j3_verdicts
  WHERE verdict = 'ok' AND outcome = 'abandoned'
) x
WHERE f.metric = 'abandoned_session_count'
  AND CAST(getvariable('enrichment_ran') AS BOOLEAN)
  AND x.n >= COALESCE(f.min_sessions, 1);
