// J3 — session classification (job type, outcome, ended-mid-work).
// Iterates over: sessions, one per call. Depends on J2 (consumes its turn
// labels in the session digest). `undetermined` is a judgment, distinct from
// the `insufficient` abstention. resumed_fragment sessions still run, judged
// from the tail only.
// Output: enrich.j3_verdicts (schema: etl/schemas/enrichment.ts J3OutputSchema).
// Contract: docs/architecture/llm.md "J3".

import { J3OutputSchema } from "../../../schemas/enrichment.ts";
import { buildJ3Packet } from "../packets.ts";
import type { JobSpec } from "../runner.ts";

export const j3Session: JobSpec = {
  id: "J3",
  selectorSqlFile: "s3_j3_selector",
  buildPacket: buildJ3Packet,
  outputSchema: J3OutputSchema,
  promptTemplate: "UNIMPLEMENTED — see docs/architecture/llm.md J3",
  promptVersion: "j3-v0",
  modelTier: "strong",
  writerSqlFile: "s3_j3_writer",
  batching: "per_record",
};
