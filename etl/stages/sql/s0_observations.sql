-- Output: raw.observations — data/observations.jsonl verbatim.
-- Columns (per SCHEMA.md): id, traceId, type, name, input, output,
--   metadata (tool_name, tool_id, tool_count), parentObservationId, level,
--   statusMessage, usageDetails, costDetails, modelId, promptTokens,
--   completionTokens, totalTokens, usage, startTime, endTime, latency.
-- Explicit column spec so absent keys (synthetic fixtures) read as NULL.
-- Gates: post — zod spot-check sample; row count (expect 8082) to manifest.
-- Contract: docs/architecture/etl.md Stage 0.
CREATE TABLE raw.observations AS
SELECT *
FROM read_json(
  getvariable('observations_path'),
  format = 'newline_delimited',
  columns = {
    id: 'VARCHAR',
    traceId: 'VARCHAR',
    type: 'VARCHAR',
    name: 'VARCHAR',
    input: 'JSON',
    output: 'JSON',
    metadata: 'JSON',
    parentObservationId: 'VARCHAR',
    level: 'VARCHAR',
    statusMessage: 'VARCHAR',
    usageDetails: 'JSON',
    costDetails: 'JSON',
    modelId: 'VARCHAR',
    promptTokens: 'BIGINT',
    completionTokens: 'BIGINT',
    totalTokens: 'BIGINT',
    usage: 'JSON',
    unit: 'VARCHAR',
    startTime: 'VARCHAR',
    endTime: 'VARCHAR',
    latency: 'DOUBLE',
    calculatedTotalCost: 'DOUBLE',
    projectId: 'VARCHAR',
    environment: 'VARCHAR',
    createdAt: 'VARCHAR',
    updatedAt: 'VARCHAR'
  }
);
