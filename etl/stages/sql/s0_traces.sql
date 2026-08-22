-- Output: raw.traces — data/traces.jsonl verbatim (one row = one turn).
-- Columns (per SCHEMA.md, unrenamed): id, name, timestamp, input, output,
--   metadata (session_id, turn_number, client, entity, linux_user,
--   auditor_email, source, resourceAttributes, scope), observations,
--   totalCost, latency, projectId, htmlPath, environment, bookmarked, public.
-- Explicit column spec so absent keys (synthetic fixtures) read as NULL.
-- Gates: post — zod spot-check of a sample (fail fast on schema drift);
--   full row count (expect 763) to manifest.
-- Contract: docs/architecture/etl.md Stage 0.
CREATE TABLE raw.traces AS
SELECT *
FROM read_json(
  getvariable('traces_path'),
  format = 'newline_delimited',
  columns = {
    id: 'VARCHAR',
    name: 'VARCHAR',
    timestamp: 'VARCHAR',
    input: 'JSON',
    output: 'JSON',
    metadata: 'JSON',
    observations: 'VARCHAR[]',
    totalCost: 'DOUBLE',
    latency: 'DOUBLE',
    projectId: 'VARCHAR',
    htmlPath: 'VARCHAR',
    environment: 'VARCHAR',
    bookmarked: 'BOOLEAN',
    public: 'BOOLEAN',
    createdAt: 'VARCHAR',
    updatedAt: 'VARCHAR'
  }
);
