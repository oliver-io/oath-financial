// J1 — gray-zone failure adjudication.
// Iterates over: tool_events where the rule table is explicitly unsure
// (signature matched with counts_as_failure = uncertain, or curated
// per-instance exceptions). NOT every match; NOT unmatched calls (J5's problem).
// Output: enrich.j1_verdicts (schema: etl/schemas/enrichment.ts J1OutputSchema).
// Contract: docs/architecture/llm.md "J1".

import { J1OutputSchema } from "../../../schemas/enrichment.ts";
import { buildJ1Packet } from "../packets.ts";
import type { JobSpec } from "../runner.ts";

export const j1Failure: JobSpec = {
  id: "J1",
  selectorSqlFile: "s3_j1_selector",
  buildPacket: buildJ1Packet,
  outputSchema: J1OutputSchema,
  promptTemplate: "UNIMPLEMENTED — see docs/architecture/llm.md J1",
  promptVersion: "j1-v0",
  modelTier: "fast",
  writerSqlFile: "s3_j1_writer",
  batching: "per_record",
};
