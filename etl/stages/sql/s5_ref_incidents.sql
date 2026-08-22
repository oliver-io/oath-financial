-- Output: publish.ref_incidents → ref/incidents.parquet — detected windows +
--   blast radius + linked friction cost (NULL degraded). Bands are global
--   annotations and stay global under filtering (documented caveat).
-- Columns (contracts IncidentRowSchema): incident_id, signature_ids
--   (JSON-encoded TEXT), start_ts/end_ts (ISO), blast_sessions,
--   blast_auditors, blast_clients, linked_friction_cost.
-- Contract: docs/architecture/etl.md Stage 5 reference plane; contracts/src/rows.ts.
CREATE TABLE publish.ref_incidents AS
SELECT
  incident_id,
  CAST(to_json(signature_ids) AS VARCHAR) AS signature_ids,
  strftime(start_ts, '%Y-%m-%dT%H:%M:%S.%gZ') AS start_ts,
  strftime(end_ts, '%Y-%m-%dT%H:%M:%S.%gZ') AS end_ts,
  CAST(blast_sessions AS INTEGER) AS blast_sessions,
  CAST(blast_auditors AS INTEGER) AS blast_auditors,
  CAST(blast_clients AS INTEGER) AS blast_clients,
  linked_friction_cost
FROM agg.incidents;
