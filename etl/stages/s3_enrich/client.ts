// OpenAI wrapper: structured-output call, backoff, repair retry.
// Contract: docs/plans/etl.md §2 client.ts; docs/plans/etl_testing.md §4–§5.
// This is the ONE module that talks to the openai SDK, and the sanctioned test
// seam: tests inject a scripted LlmClient here — the real runner, validation,
// repair loop, cache and writers all execute against it.
// Fail-loud construction: there is NO anonymous/default endpoint path. A real
// client without an explicit key throws MissingCredentialsError immediately —
// it never attempts the network. (The env-scrubbing canaries in the test
// harness depend on this; do not add an env fallback here.)

import OpenAI from "openai";
import type { EnrichmentEnv } from "../../context.ts";
import { MissingCredentialsError, Unimplemented } from "../../lib/errors.ts";

/** One structured-output request: prompt + JSON Schema derived from the job's
 * zod schema. The client returns the raw text; parsing/validation is the
 * runner's job (so scripted clients exercise the real validation path). */
export interface LlmRequest {
  job: string;
  model: string;
  prompt: string;
  /** JSON Schema for response_format, derived from the job's zod output schema. */
  responseJsonSchema: Record<string, unknown>;
}

export interface LlmResponse {
  text: string;
}

/** The injectable seam. Production: OpenAiClient. Tests: a scripted client. */
export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Injectable sleep so backoff tests don't wait (docs/plans/etl_testing.md §2). */
export type Sleep = (ms: number) => Promise<void>;

/** Constructs the client for a run — the injection point the test harness
 * overrides with a scripted client (docs/plans/etl_testing.md §4). */
export type ClientFactory = (env: EnrichmentEnv, sleep: Sleep) => LlmClient;

/** A retryable HTTP failure surfaced by the client seam (429/5xx). The
 * runner's backoff loop keys off `status` — scripted clients throw this too,
 * so backoff is exercised through the real runner. */
export class LlmHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`LLM endpoint returned HTTP ${status}`);
    this.name = "LlmHttpError";
    this.status = status;
  }
}

/** A request timeout surfaced by the client seam; retried once by the runner. */
export class LlmTimeoutError extends Error {
  constructor() {
    super("LLM request timed out");
    this.name = "LlmTimeoutError";
  }
}

export class OpenAiClient implements LlmClient {
  private readonly sdk: OpenAI;

  constructor(env: EnrichmentEnv, _sleep: Sleep) {
    if (!env.apiKey) {
      throw new MissingCredentialsError("OpenAiClient constructed without an explicit API key");
    }
    this.sdk = new OpenAI({
      apiKey: env.apiKey,
      ...(env.baseUrl ? { baseURL: env.baseUrl } : {}),
    });
  }

  /** Dispatches one structured-output call with exponential backoff on 429/5xx
   * (bounded retries; timeout retried once). Repair retries live in the runner. */
  complete(_request: LlmRequest): Promise<LlmResponse> {
    void this.sdk; // dispatch through the SDK is stage-3 work
    throw new Unimplemented("OpenAiClient.complete", "docs/architecture/etl.md Stage 3");
  }
}

/** Production sleep. */
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
