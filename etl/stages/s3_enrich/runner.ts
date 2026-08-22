// Generic enrichment-job executor: selector → packets → cache → call → write.
// Contract: docs/plans/etl.md §3 JobSpec/runner; docs/architecture/etl.md Stage 3.
// The runner owns everything generic: cache lookup by
// sha256(job|packet_hash|prompt_version|model), batching under the token
// budget, p-limit concurrency (~8), exponential backoff on 429/5xx (via the
// injected client/sleep), ONE schema-repair retry then an enrich_error row,
// transactional batch writes (killed runs resume at record level), and the
// end-of-job invariant: EVERY selected record has exactly one row — a verdict,
// an abstention with reason, or an error. A failed invariant is a hard error
// (EnrichmentInvariantViolation → exit 3). Coverage counts go to the manifest.

import type { ZodType } from "zod";
import type { RunContext } from "../../context.ts";
import { Unimplemented } from "../../lib/errors.ts";
import type { EnrichmentCoverage } from "../../schemas/run_manifest.ts";
import type { LlmCache } from "./cache.ts";
import type { LlmClient, Sleep } from "./client.ts";
import type { PacketBuilder } from "./packets.ts";

export type JobId = "J1" | "J2" | "J3" | "J4" | "J5";

/** One enrichment job = (selector, packet builder, prompt, schema, writer).
 * Contract: docs/plans/etl.md §3 JobSpec. */
export interface JobSpec {
  id: JobId;
  /** SQL file (etl/stages/sql/) returning record keys + packet inputs. */
  selectorSqlFile: string;
  buildPacket: PacketBuilder;
  outputSchema: ZodType;
  promptTemplate: string;
  promptVersion: string;
  /** "fast" = snippet-level (J1/J5); "strong" = contextual judgment (J2/J3/J4). */
  modelTier: "fast" | "strong";
  /** SQL insert of verdict/abstention/error rows into enrich.<table>. */
  writerSqlFile: string;
  /** Batch grain: records per call (J2 batches many turns of one session;
   * session-level jobs are one session per call). */
  batching: "per_record" | "per_session_batch";
}

export interface RunJobOptions {
  ctx: RunContext;
  job: JobSpec;
  client: LlmClient;
  cache: LlmCache;
  sleep: Sleep;
  /** `etl enrich --recache`: ignore the cache (explicit flag, never default). */
  recache: boolean;
}

/** Executes one job end-to-end and returns its coverage counts
 * (judged / abstained / error / cached_hit) for the manifest. */
export function runJob(_opts: RunJobOptions): Promise<EnrichmentCoverage> {
  throw new Unimplemented("s3_enrich/runner.runJob", "docs/plans/etl.md §3 JobSpec");
}
