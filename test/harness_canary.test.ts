// Escape-hatch canaries (docs/plans/etl_testing.md §5) + harness self-checks.
// These MUST PASS in the red phase: they prove the trap that keeps every other
// test off the network. If someone later adds a default base URL or an env
// fallback to client.ts, these break — that is their job.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { MissingCredentialsError } from "../etl/lib/errors.ts";
import { J1OutputSchema } from "../etl/schemas/enrichment.ts";
import { scrubEnv, withHarness } from "./harness.ts";
import { ScriptedClient, valid } from "./helpers/responses.ts";

describe("canary: the no-credentials trap", () => {
  test("runJob without injectResponses fails fast with MissingCredentialsError, zero rows, non-zero exit", async () => {
    await withHarness("canary-no-credentials", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runJob("J1");
      expect(r.error).toBeInstanceOf(MissingCredentialsError);
      expect(r.exitCode).not.toBe(0);
      expect(r.coverage).toBeNull();
      // Zero rows written anywhere: no enrich tables, no cache rows.
      expect(await h.tableExists("enrich.j1_verdicts")).toBe(false);
      expect(h.cacheRows()).toEqual([]);
    });
  });

  test("a script shorter than the call count hits the trap, naming the job", async () => {
    const client = new ScriptedClient([
      valid(J1OutputSchema, {
        verdict: "non_failure",
        reason: "benign_message",
        insufficient_reason: null,
        confidence: "high",
        evidence: "the packet shows a normal completion",
      }),
    ]);
    const request = {
      job: "J1",
      model: "scripted-fast",
      prompt: "record tool_event=0650f74e1e88da5a …",
      responseJsonSchema: {},
    };
    await client.complete(request); // consumes the single step
    expect(() => client.complete(request)).toThrow(MissingCredentialsError);
    try {
      await client.complete(request);
      throw new Error("unreachable: the exhausted script must throw");
    } catch (err) {
      expect(String(err)).toContain("J1");
      expect(String(err)).toContain("call 3");
    }
  });
});

describe("harness self-checks", () => {
  test("env scrubbing removes OPENAI_*/ETL_MODEL_* before the test body runs", async () => {
    process.env.OPENAI_API_KEY = "should-be-scrubbed";
    process.env.OPENAI_BASE_URL = "http://should-be-scrubbed";
    process.env.ETL_MODEL_FAST = "should-be-scrubbed";
    await withHarness("canary-env-scrub", async () => {
      expect(process.env.OPENAI_API_KEY).toBeUndefined();
      expect(process.env.OPENAI_BASE_URL).toBeUndefined();
      expect(process.env.ETL_MODEL_FAST).toBeUndefined();
    });
    scrubEnv();
  });

  test("workspace is created fresh and deleted on success", async () => {
    let dir = "";
    await withHarness("canary-workspace", async (h) => {
      dir = h.dir;
      expect(existsSync(dir)).toBe(true);
      h.stageFixtures("violations/referential");
      expect(existsSync(`${dir}/data/traces.jsonl`)).toBe(true);
      expect(existsSync(`${dir}/etl/rules/signatures.yaml`)).toBe(true);
    });
    expect(existsSync(dir)).toBe(false);
  });

  test("valid() rejects a script value that drifts from the job schema", () => {
    expect(() =>
      valid(J1OutputSchema, {
        // @ts-expect-error — deliberate drift: not a J1 verdict
        verdict: "not-a-verdict",
        reason: null,
        insufficient_reason: null,
        confidence: "high",
        evidence: "x",
      }),
    ).toThrow();
  });
});
