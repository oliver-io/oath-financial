// J5 — heuristic audit (error-bar estimation).
// Iterates over: two fixed seeded random samples computed in stage 2 —
// N=150 unmatched tool outputs (missed failures?) and M=100 matched ones
// (false positives?); seeds/sizes from etl/rules/thresholds.yaml. Stage 4
// turns the sample rates into error bars on failure counts. The audit never
// modifies verdicts — it measures the instrument.
// Output: enrich.j5_audit (schema: etl/schemas/enrichment.ts J5OutputSchema).
// Contract: docs/architecture/llm.md "J5". Can run any time after stage 2.

import { J5OutputSchema } from "../../../schemas/enrichment.ts";
import { buildJ5Packet } from "../packets.ts";
import type { JobSpec } from "../runner.ts";

export const j5Audit: JobSpec = {
  id: "J5",
  selectorSqlFile: "s3_j5_selector",
  buildPacket: buildJ5Packet,
  outputSchema: J5OutputSchema,
  promptTemplate: "UNIMPLEMENTED — see docs/architecture/llm.md J5",
  promptVersion: "j5-v0",
  modelTier: "fast",
  writerSqlFile: "s3_j5_writer",
  batching: "per_record",
};
