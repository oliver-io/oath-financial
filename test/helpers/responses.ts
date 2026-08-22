// Typed response-script helpers + the scripted LlmClient installed at the
// client.ts seam (docs/plans/etl_testing.md §4). A script is an ordered list of
// per-CALL outcomes; batch-grain jobs consume one step per batched call. The
// scripted client is response-injection only: the real runner, zod validation,
// repair loop, cache and writers all execute against it.

import type { ZodType, z } from "zod";
import { MissingCredentialsError } from "../../etl/lib/errors.ts";
import {
  type LlmClient,
  LlmHttpError,
  type LlmRequest,
  type LlmResponse,
  LlmTimeoutError,
} from "../../etl/stages/s3_enrich/client.ts";

export type ScriptStep =
  | { kind: "valid"; json: unknown }
  | { kind: "invalid"; json: unknown }
  | { kind: "malformed"; text: string }
  | { kind: "http"; status: 429 | 500 }
  | { kind: "timeout" };

/** A schema-checked valid response: drift from the job's zod schema fails at
 * typecheck (via z.infer) AND at script-construction time (parse). */
export function valid<S extends ZodType>(schema: S, value: z.infer<S>): ScriptStep {
  schema.parse(value);
  return { kind: "valid", json: value };
}

/** Deliberately schema-invalid JSON (exercises the repair loop). */
export const invalid = (json: unknown): ScriptStep => ({ kind: "invalid", json });

/** Non-JSON text (exercises the parse-failure path). */
export const malformed = (text: string): ScriptStep => ({ kind: "malformed", text });

/** Retryable HTTP failure surfaced by the seam (backoff path). */
export const http = (status: 429 | 500): ScriptStep => ({ kind: "http", status });

/** Request timeout (retried once by the runner). */
export const timeout = (): ScriptStep => ({ kind: "timeout" });

/** A flat per-call script, or per-job scripts for full-pipeline runs.
 * `repeatLast` (explicit opt-in, full-pipeline happy paths only) repeats a
 * job's final step instead of exhausting — the default stays the trap. */
export type ScriptSpec =
  | readonly ScriptStep[]
  | { perJob: Record<string, readonly ScriptStep[]>; repeatLast?: boolean };

/** The scripted client. Exhausting the script hits the same fail-loud trap as
 * an uninjected real client (docs/plans/etl_testing.md §5 canary b): it throws
 * MissingCredentialsError naming the job and the overflowing call so the
 * failure is diagnosable and can never reach a network. */
export class ScriptedClient implements LlmClient {
  readonly calls: LlmRequest[] = [];
  private readonly cursors = new Map<string, number>();

  constructor(private readonly spec: ScriptSpec) {}

  get callCount(): number {
    return this.calls.length;
  }

  private nextStep(job: string): ScriptStep | undefined {
    const flat = Array.isArray(this.spec);
    const steps = flat
      ? (this.spec as readonly ScriptStep[])
      : ((this.spec as { perJob: Record<string, readonly ScriptStep[]> }).perJob[job] ?? []);
    const key = flat ? "*" : job;
    const cursor = this.cursors.get(key) ?? 0;
    this.cursors.set(key, cursor + 1);
    const step = steps[cursor];
    if (step) return step;
    const repeat = !flat && (this.spec as { repeatLast?: boolean }).repeatLast === true;
    return repeat ? steps[steps.length - 1] : undefined;
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const step = this.nextStep(request.job);
    if (!step) {
      throw new MissingCredentialsError(
        `response script exhausted for job ${request.job} at call ${this.calls.length} ` +
          `(record/prompt head: ${request.prompt.slice(0, 120).replace(/\s+/g, " ")})`,
      );
    }
    switch (step.kind) {
      case "valid":
      case "invalid":
        return Promise.resolve({ text: JSON.stringify(step.json) });
      case "malformed":
        return Promise.resolve({ text: step.text });
      case "http":
        return Promise.reject(new LlmHttpError(step.status));
      case "timeout":
        return Promise.reject(new LlmTimeoutError());
    }
  }
}
