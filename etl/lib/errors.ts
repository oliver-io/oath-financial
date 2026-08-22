// Shared typed errors for the pipeline.
// Contract: docs/plans/etl.md §5 — no silent catches; errors either abort the
// stage or become typed abstention/error rows (enrichment only).

/** A declared-but-not-yet-built code path. Message = module + contract reference. */
export class Unimplemented extends Error {
  constructor(module: string, contractRef: string) {
    super(`${module}: see ${contractRef}`);
    this.name = "Unimplemented";
  }
}

/** Thrown when enrichment is requested but no API key is present, or when the
 * client is constructed without an explicit key (there is no anonymous/default
 * endpoint path — docs/plans/etl_testing.md §5). */
export class MissingCredentialsError extends Error {
  constructor(detail: string) {
    super(`missing LLM credentials: ${detail}`);
    this.name = "MissingCredentialsError";
  }
}

/** A stage gate failed. The CLI maps this to exit code 2. */
export class GateFailure extends Error {
  readonly gate: string;
  constructor(gate: string, detail: string) {
    super(`gate '${gate}' failed: ${detail}`);
    this.name = "GateFailure";
    this.gate = gate;
  }
}

/** The exactly-one-row-per-selected-record enrichment invariant was violated.
 * The CLI maps this to exit code 3 (docs/plans/etl.md §4 step 9). */
export class EnrichmentInvariantViolation extends Error {
  readonly job: string;
  constructor(job: string, detail: string) {
    super(`enrichment invariant violated for ${job}: ${detail}`);
    this.name = "EnrichmentInvariantViolation";
    this.job = job;
  }
}
