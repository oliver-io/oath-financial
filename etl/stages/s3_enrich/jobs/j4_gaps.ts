// J4 — capability-gap naming & grouping.
// Iterates over: stage-2 pattern clusters (browser-grind, extract-paste,
// shell-PDF, orchestration scaffolding) — one call per cluster with exemplar
// session digests; < 10 calls. exemplar ids must be ⊆ input ids (validated;
// violation = enrich_error). The model names and groups, NEVER counts.
// Output: enrich.j4_gaps (schema: etl/schemas/enrichment.ts J4OutputSchema).
// Contract: docs/architecture/llm.md "J4". Depends on J3.

import { J4OutputSchema } from "../../../schemas/enrichment.ts";
import { buildJ4Packet } from "../packets.ts";
import type { JobSpec } from "../runner.ts";

export const j4Gaps: JobSpec = {
  id: "J4",
  selectorSqlFile: "s3_j4_selector",
  buildPacket: buildJ4Packet,
  outputSchema: J4OutputSchema,
  promptTemplate: "UNIMPLEMENTED — see docs/architecture/llm.md J4",
  promptVersion: "j4-v0",
  modelTier: "strong",
  writerSqlFile: "s3_j4_writer",
  batching: "per_record",
};
