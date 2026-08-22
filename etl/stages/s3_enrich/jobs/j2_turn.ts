// J2 — turn classification (friction, correction).
// Iterates over: ALL turns for turn_friction/friction_cause; only
// short_typed_after_short_gap candidates for is_correction. Batched many turns
// of the SAME session per call. linked_signature_pattern is validated post-hoc
// against stage-2 matches (dangling → friction_cause downgraded to none + flag).
// Output: enrich.j2_verdicts (schema: etl/schemas/enrichment.ts J2OutputSchema).
// Contract: docs/architecture/llm.md "J2".

import { J2OutputSchema } from "../../../schemas/enrichment.ts";
import { buildJ2Packet } from "../packets.ts";
import type { JobSpec } from "../runner.ts";

export const j2Turn: JobSpec = {
  id: "J2",
  selectorSqlFile: "s3_j2_selector",
  buildPacket: buildJ2Packet,
  outputSchema: J2OutputSchema,
  promptTemplate: "UNIMPLEMENTED — see docs/architecture/llm.md J2",
  promptVersion: "j2-v0",
  modelTier: "strong",
  writerSqlFile: "s3_j2_writer",
  batching: "per_session_batch",
};
