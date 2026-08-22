-- Output: publish.ref_dims → ref/dims.parquet — shared slice dimensions
--   (derivations.md §8): client, entity (parent = client), auditor,
--   tool_family, job_type taxonomy (contracts authority, via _job_types),
--   signature_class. Same filter bar on both sides of the app.
-- Columns (contracts DimRowSchema): kind, value, parent.
-- Contract: docs/architecture/etl.md Stage 5 reference plane; contracts/src/rows.ts.
CREATE TABLE publish.ref_dims AS
SELECT 'client' AS kind, client AS value, CAST(NULL AS VARCHAR) AS parent
FROM (SELECT DISTINCT client FROM derive.sessions)
UNION ALL
SELECT 'entity', entity, client
FROM (SELECT DISTINCT entity, client FROM derive.sessions)
UNION ALL
SELECT 'auditor', auditor, NULL
FROM (SELECT DISTINCT auditor FROM derive.sessions)
UNION ALL
SELECT 'tool_family', family, NULL
FROM (SELECT DISTINCT family FROM _tool_families)
UNION ALL
SELECT 'job_type', value, NULL FROM _job_types
UNION ALL
SELECT 'signature_class', signature_class, NULL
FROM (SELECT DISTINCT signature_class FROM _signature_rules);
