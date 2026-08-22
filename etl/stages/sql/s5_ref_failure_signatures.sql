-- Output: publish.ref_failure_signatures → ref/failure_signatures.parquet.
-- Columns (contracts FailureSignatureRowSchema): agg.failure_signatures with
--   publish-time encodings: counts_as_failure as the published STRING enum
--   ("true"|"false"|"uncertain" — the rules schema's boolean-union is mapped
--   at stage 2 injection; cross-track seam item 2), rule_version =
--   signatures.yaml version string (sha256 hashes stay in the internal run
--   manifest only — seam item 4), first_seen/last_seen as ISO strings,
--   daily_series JSON-encoded TEXT. Stable public keys: pattern_id from
--   rules/signatures.yaml (deeplinks survive re-runs).
-- Contract: docs/architecture/etl.md Stage 5 reference plane; contracts/src/rows.ts.
CREATE TABLE publish.ref_failure_signatures AS
SELECT
  pattern_id,
  display_name,
  signature_class,
  counts_as_failure,
  CAST(getvariable('signatures_version') AS VARCHAR) AS rule_version,
  CAST(event_count AS INTEGER) AS event_count,
  CAST(session_count AS INTEGER) AS session_count,
  CAST(auditor_count AS INTEGER) AS auditor_count,
  CAST(client_count AS INTEGER) AS client_count,
  strftime(first_seen, '%Y-%m-%dT%H:%M:%S.%gZ') AS first_seen,
  strftime(last_seen, '%Y-%m-%dT%H:%M:%S.%gZ') AS last_seen,
  series_start_day,
  CAST(to_json(daily_series) AS VARCHAR) AS daily_series,
  terminal_rate,
  CAST(shape_same_tool_clean_later AS INTEGER) AS shape_same_tool_clean_later,
  CAST(shape_other_calls_after AS INTEGER) AS shape_other_calls_after,
  CAST(shape_turn_ends_on_failure AS INTEGER) AS shape_turn_ends_on_failure,
  j5_false_positive_rate,
  j5_missed_rate
FROM agg.failure_signatures;
