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
--   (they are exactly the non-degraded card set). Only metric='event_count'
--   is computable at M2 (both current rules); other metrics are future rules.
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
  AND (f.min_auditors IS NULL OR a.auditor_count >= f.min_auditors);
