// The enrichment-runner response matrix (docs/plans/etl_testing.md §4): every
// script runs through the REAL runner — real zod validation, repair loop,
// cache, writers — with responses injected at the client.ts seam. Table-driven:
// adding a schema branch adds a table line. RED until runner/cache land.

import { describe, expect, test } from "bun:test";
import { exitCodeForError } from "../etl/cli.ts";
import { EnrichmentInvariantViolation } from "../etl/lib/errors.ts";
import {
  J1OutputSchema,
  J2OutputSchema,
  J3OutputSchema,
  J5OutputSchema,
} from "../etl/schemas/enrichment.ts";
import type { JobId } from "../etl/stages/s3_enrich/runner.ts";
import { expectJobReal, type Harness, withHarness } from "./harness.ts";
import { happyJ2, happyJ4, happyJ5 } from "./helpers/happy.ts";
import { http, invalid, malformed, type ScriptStep, timeout, valid } from "./helpers/responses.ts";

const TABLE_FOR: Record<JobId, string> = {
  J1: "enrich.j1_verdicts",
  J2: "enrich.j2_verdicts",
  J3: "enrich.j3_verdicts",
  J4: "enrich.j4_gaps",
  J5: "enrich.j5_audit",
};

/** Runs one job over the slice with a per-job script (padded via repeatLast so
 * later records reuse the final step) and returns rows + spies. */
async function runMatrixCase(h: Harness, job: JobId, script: ScriptStep[], pad?: ScriptStep) {
  h.stageFixtures("slice");
  const client = h.injectResponses({
    perJob: { [job]: pad ? [...script, pad] : script },
    repeatLast: pad !== undefined,
  });
  const result = await h.runJob(job);
  expectJobReal(result);
  const rows = await h.rowsIn(TABLE_FOR[job]);
  return { client, result, rows };
}

// ---------------------------------------------------------------------------
// Happy paths — every enum branch produces a row with the right shape.
// ---------------------------------------------------------------------------

const j1Reasons = [
  "user_declined",
  "recovered_immediately",
  "benign_message",
  "genuine_failure",
  "other",
] as const;

describe("J1 happy paths", () => {
  for (const [i, reason] of j1Reasons.entries()) {
    const verdict = i % 2 === 0 ? "non_failure" : "failure";
    const confidence = i % 2 === 0 ? "high" : "low";
    test(`verdict=${verdict} reason=${reason} confidence=${confidence}`, async () => {
      await withHarness(`j1-happy-${reason}`, async (h) => {
        const step = valid(J1OutputSchema, {
          verdict,
          reason,
          insufficient_reason: null,
          confidence,
          evidence: `packet shows ${reason}`,
        });
        const { result, rows } = await runMatrixCase(h, "J1", [step], step);
        expect(result.coverage?.judged ?? 0).toBeGreaterThan(0);
        const hit = rows.find((r) => r.reason === reason && r.verdict === verdict);
        expect(hit?.confidence).toBe(confidence);
        expect(String(hit?.evidence)).toContain(reason);
      });
    });
  }
});

const j2Causes = [
  "system_failure",
  "capability_gap",
  "agent_behavior",
  "user_request",
  "none",
] as const;

describe("J2 happy paths", () => {
  for (const cause of j2Causes) {
    test(`friction_cause=${cause} (linked pattern ${cause === "system_failure" ? "present" : "null"})`, async () => {
      await withHarness(`j2-happy-${cause}`, async (h) => {
        const step = valid(J2OutputSchema, {
          turn_friction: cause === "none" ? 0 : 0.8,
          friction_cause: cause,
          // A pattern that really matches in the slice keeps the post-hoc
          // validator satisfied (dangling case is in the sad table).
          linked_signature_pattern: cause === "system_failure" ? "portal-token-missing" : null,
          is_correction: false,
          verdict: "ok",
          insufficient_reason: null,
          evidence: `cause is ${cause}`,
        });
        const { rows } = await runMatrixCase(h, "J2", [step], step);
        expect(rows.some((r) => r.friction_cause === cause)).toBe(true);
      });
    });
  }

  for (const isCorrection of [true, false]) {
    test(`is_correction=${isCorrection} on a candidate turn`, async () => {
      await withHarness(`j2-correction-${isCorrection}`, async (h) => {
        const step = valid(J2OutputSchema, {
          turn_friction: 0.2,
          friction_cause: "none",
          linked_signature_pattern: null,
          is_correction: isCorrection,
          verdict: "ok",
          insufficient_reason: null,
          evidence: "short typed follow-up after a short gap",
        });
        const { rows } = await runMatrixCase(h, "J2", [step], step);
        expect(rows.some((r) => r.is_correction === isCorrection)).toBe(true);
      });
    });
  }
});

const j3JobTypes = [
  "doc_receipt_check",
  "doc_location",
  "doc_inventory",
  "tie_out",
  "portal_auth",
  "extraction_supervision",
  "drafting",
  "capability_probe",
  "other",
] as const;
const j3Outcomes = ["completed", "abandoned", "undetermined"] as const;

describe("J3 happy paths", () => {
  for (const [i, jobType] of j3JobTypes.entries()) {
    const outcome = j3Outcomes[i % 3] as (typeof j3Outcomes)[number];
    const ended = i % 2 === 0;
    test(`job_type=${jobType} outcome=${outcome} ended_mid_work=${ended}`, async () => {
      await withHarness(`j3-happy-${jobType}`, async (h) => {
        const step = valid(J3OutputSchema, {
          job_type: jobType,
          job_type_secondary: null,
          outcome,
          outcome_evidence: "final turn states the state (turn 3)",
          ended_mid_work: ended,
          verdict: "ok",
          insufficient_reason: null,
        });
        const { rows } = await runMatrixCase(h, "J3", [step], step);
        const hit = rows.find((r) => r.job_type === jobType);
        expect(hit?.outcome).toBe(outcome);
        expect(hit?.ended_mid_work).toBe(ended);
        // `undetermined` is a judgment, written as a verdict row — asserted
        // distinct from abstention in the written row.
        if (outcome === "undetermined") expect(hit?.verdict).toBe("ok");
      });
    });
  }
});

describe("J4 happy path", () => {
  test("valid naming with exemplar ids ⊆ input ids", async () => {
    await withHarness("j4-happy", async (h) => {
      // The browser-heavy slice session is the guaranteed exemplar candidate.
      const sid = "9b58b0bc";
      h.stageFixtures("slice");
      const traces = await Bun.file(`${h.dir}/data/traces.jsonl`).text();
      const fullId = traces
        .split("\n")
        .map((l) => (l ? (JSON.parse(l) as { metadata: { session_id: string } }) : null))
        .find((t) => t?.metadata.session_id.startsWith(sid))?.metadata.session_id;
      const step = happyJ4([fullId ?? sid]);
      const client = h.injectResponses({ perJob: { J4: [step] }, repeatLast: true });
      const result = await h.runJob("J4");
      expectJobReal(result);
      const rows = await h.rowsIn(TABLE_FOR.J4);
      expect(rows.length).toBeGreaterThan(0);
      expect(client.callCount).toBeGreaterThan(0);
      const hit = rows.find((r) => String(r.display_name).includes("Browser grind"));
      expect(hit).toBeDefined();
    });
  });
});

describe("J5 happy paths", () => {
  for (const assessment of ["missed_failure", "correct", "false_positive"] as const) {
    test(`assessment=${assessment}`, async () => {
      await withHarness(`j5-happy-${assessment}`, async (h) => {
        const step = valid(J5OutputSchema, {
          assessment,
          insufficient_reason: null,
          evidence: `snippet reads as ${assessment}`,
        });
        const { rows, result } = await runMatrixCase(h, "J5", [step], step);
        expect(result.coverage?.judged ?? 0).toBeGreaterThan(0);
        expect(rows.some((r) => r.assessment === assessment)).toBe(true);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Sad paths — one test per row, interior (spies) + final state.
// ---------------------------------------------------------------------------

describe("sad paths (J5 carrier unless job-specific)", () => {
  test("invalid then valid: 1 extra call, repair prompt carries the validation error, normal verdict row", async () => {
    await withHarness("sad-invalid-then-valid", async (h) => {
      const { client, result } = await runMatrixCase(
        h,
        "J5",
        [invalid({ assessment: "not-an-assessment" }), happyJ5()],
        happyJ5(),
      );
      expect(result.coverage?.error ?? -1).toBe(0);
      expect(client.callCount).toBe((result.coverage?.judged ?? 0) + 1);
      const repairPrompt = client.calls[1]?.prompt ?? "";
      expect(repairPrompt.toLowerCase()).toContain("invalid");
    });
  });

  test("invalid ×2: stop after 2 calls for that record, enrich_error/schema_failure row, job continues", async () => {
    await withHarness("sad-double-invalid", async (h) => {
      const bad = invalid({ assessment: "nope" });
      const { result, rows, client } = await runMatrixCase(h, "J5", [bad, bad], happyJ5());
      expect(result.coverage?.error).toBe(1);
      expect(result.coverage?.judged ?? 0).toBeGreaterThan(0); // continued to next records
      const errRows = rows.filter((r) => r.insufficient_reason === "schema_failure");
      expect(errRows).toHaveLength(1);
      expect(client.callCount).toBe((result.coverage?.judged ?? 0) + 2);
    });
  });

  test("malformed (non-JSON) ×2: same as the invalid path", async () => {
    await withHarness("sad-double-malformed", async (h) => {
      const bad = malformed("I am not JSON {{{");
      const { result, rows } = await runMatrixCase(h, "J5", [bad, bad], happyJ5());
      expect(result.coverage?.error).toBe(1);
      expect(rows.filter((r) => r.insufficient_reason === "schema_failure")).toHaveLength(1);
    });
  });

  for (const reason of ["unreadable_context", "other"] as const) {
    test(`model abstention insufficient/${reason}: 1 call, abstention row counted in coverage`, async () => {
      await withHarness(`sad-abstain-${reason}`, async (h) => {
        const abstain = valid(J5OutputSchema, {
          assessment: "insufficient",
          insufficient_reason: reason,
          evidence: "cannot read the snippet",
        });
        const { result, rows } = await runMatrixCase(h, "J5", [abstain], happyJ5());
        expect(result.coverage?.abstained ?? 0).toBeGreaterThanOrEqual(1);
        expect(rows.some((r) => r.insufficient_reason === reason)).toBe(true);
      });
    });
  }

  test("429 ×2 then valid: backoff invoked twice via the injected sleep, normal verdict row", async () => {
    await withHarness("sad-429-backoff", async (h) => {
      const { result } = await runMatrixCase(h, "J5", [http(429), http(429), happyJ5()], happyJ5());
      expect(result.coverage?.error ?? -1).toBe(0);
      expect(h.sleeps.length).toBe(2);
      // Exponential: the second wait is strictly longer than the first.
      const [s1, s2] = h.sleeps;
      expect(s2 ?? 0).toBeGreaterThan(s1 ?? Number.POSITIVE_INFINITY);
    });
  });

  test("persistent 500: bounded retries then enrich_error row; job continues to next record", async () => {
    await withHarness("sad-persistent-500", async (h) => {
      const fives = Array.from({ length: 10 }, () => http(500));
      const { result, rows, client } = await runMatrixCase(h, "J5", fives, happyJ5());
      expect(result.coverage?.error).toBe(1);
      expect(result.coverage?.judged ?? 0).toBeGreaterThan(0);
      // Bounded: at most the 10 scripted failures plus one happy call per judged
      // record. (ScriptedClient's cursor is shared per-call, so an error record
      // plus judged records necessarily consume all 10 fives — callCount equals
      // judged + 10 exactly; strict `<` was a test-authoring bug, see
      // PROGRESS_LOG §30.)
      expect(client.callCount).toBeLessThanOrEqual((result.coverage?.judged ?? 0) + 10);
      expect(rows.filter((r) => r.insufficient_reason === "schema_failure")).toHaveLength(0);
    });
  });

  test("timeout then valid: one retry, normal verdict row", async () => {
    await withHarness("sad-timeout-retry", async (h) => {
      const { result, client } = await runMatrixCase(h, "J5", [timeout(), happyJ5()], happyJ5());
      expect(result.coverage?.error ?? -1).toBe(0);
      expect(client.callCount).toBe((result.coverage?.judged ?? 0) + 1);
    });
  });

  test("J2 dangling linked_signature_pattern: post-hoc validation downgrades friction_cause to none + flag", async () => {
    await withHarness("sad-j2-dangling", async (h) => {
      const dangling = valid(J2OutputSchema, {
        turn_friction: 0.9,
        friction_cause: "system_failure",
        linked_signature_pattern: "no-such-pattern-id",
        is_correction: false,
        verdict: "ok",
        insufficient_reason: null,
        evidence: "claims a failure that stage 2 never matched",
      });
      const { rows } = await runMatrixCase(h, "J2", [dangling], happyJ2());
      const downgraded = rows.filter(
        (r) => r.friction_cause === "none" && (r.linked_signature_pattern ?? null) === null,
      );
      expect(downgraded.length).toBeGreaterThanOrEqual(1);
      // The downgrade is flagged, never silent (derivations.md §2 / llm.md J2).
      expect(rows.some((r) => r.dangling_signature_flag === true)).toBe(true);
      // No row retains the invented pattern.
      expect(rows.every((r) => r.linked_signature_pattern !== "no-such-pattern-id")).toBe(true);
    });
  });

  test("J4 exemplar id ∉ input: enrich_error row — the model invented data", async () => {
    await withHarness("sad-j4-invented-exemplar", async (h) => {
      const invented = happyJ4(["ffffffff-not-a-session-in-the-input"]);
      const { result, rows } = await runMatrixCase(h, "J4", [invented], invented);
      expect(result.coverage?.error ?? 0).toBeGreaterThanOrEqual(1);
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  test("packet-builder skips spend nothing: client calls == judged count exactly", async () => {
    await withHarness("sad-zero-spend-on-skips", async (h) => {
      const { result, client } = await runMatrixCase(h, "J5", [happyJ5()], happyJ5());
      // Every abstained/error record must have consumed ZERO calls with an
      // all-happy script: calls land only for judged records.
      expect(client.callCount).toBe(result.coverage?.judged ?? -1);
      // The invariant: one row per selected record.
      const rows = await h.rowsIn(TABLE_FOR.J5);
      const cov = result.coverage;
      expect(rows.length).toBe((cov?.judged ?? 0) + (cov?.abstained ?? 0) + (cov?.error ?? 0));
    });
  });
});

// ---------------------------------------------------------------------------
// Batch grain (J2 packs many turns of one session per call).
// ---------------------------------------------------------------------------

describe("batch grain", () => {
  test("a double-invalid batched J2 call yields enrich_error rows for ALL records in that batch, and only those", async () => {
    await withHarness("batch-j2-double-invalid", async (h) => {
      const bad = invalid({ turn_friction: "high" });
      const { result, rows } = await runMatrixCase(h, "J2", [bad, bad], happyJ2());
      const errRows = rows.filter((r) => r.insufficient_reason === "schema_failure");
      expect(errRows.length).toBeGreaterThan(0);
      // All error rows share one session (the batch is one session's turns)...
      const errSessions = new Set(errRows.map((r) => String(r.session_id)));
      expect(errSessions.size).toBe(1);
      const [sid] = [...errSessions];
      // ...and cover that session's every selected turn — none judged there.
      expect(rows.some((r) => String(r.session_id) === sid && r.insufficient_reason == null)).toBe(
        false,
      );
      expect(result.coverage?.error).toBe(errRows.length);
      // Exactly-one-row invariant across the whole run.
      const seen = new Set(rows.map((r) => `${r.session_id}/${r.turn_number}`));
      expect(seen.size).toBe(rows.length);
    });
  });
});

// ---------------------------------------------------------------------------
// The invariant's exit-code contract.
// ---------------------------------------------------------------------------

describe("invariant violation exit code", () => {
  test("EnrichmentInvariantViolation maps to exit 3 (structural: the violation itself is unforgeable through the seam by design)", () => {
    expect(
      exitCodeForError(new EnrichmentInvariantViolation("J2", "761 rows for 763 records")),
    ).toBe(3);
  });
});
