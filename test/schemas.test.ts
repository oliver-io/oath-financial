// Structural schema tests (legitimately green): the enrichment output
// contracts transcribed from docs/architecture/llm.md, and the manifest shape.
// These guard the shape the response-matrix tests script against — a schema
// drift here breaks scripts at typecheck, not at runtime
// (docs/plans/etl_testing.md §6).

import { describe, expect, test } from "bun:test";
import { ManifestRecorder } from "../etl/lib/manifest.ts";
import {
  J1OutputSchema,
  J2OutputSchema,
  J3OutputSchema,
  J4OutputSchema,
  J5OutputSchema,
} from "../etl/schemas/enrichment.ts";

describe("enrichment output schemas (llm.md contracts)", () => {
  test("J1 accepts every verdict/reason/confidence branch", () => {
    for (const verdict of ["failure", "non_failure"] as const) {
      for (const reason of [
        "user_declined",
        "recovered_immediately",
        "benign_message",
        "genuine_failure",
        "other",
      ] as const) {
        for (const confidence of ["high", "low"] as const) {
          expect(
            J1OutputSchema.safeParse({
              verdict,
              reason,
              insufficient_reason: null,
              confidence,
              evidence: "cites the packet",
            }).success,
          ).toBe(true);
        }
      }
    }
  });

  test("J1 abstention carries a machine-readable insufficient_reason", () => {
    for (const insufficient_reason of [
      "missing_source_field",
      "packet_overflow",
      "unreadable_context",
      "other",
    ] as const) {
      expect(
        J1OutputSchema.safeParse({
          verdict: "insufficient",
          reason: null,
          insufficient_reason,
          confidence: "low",
          evidence: "n/a",
        }).success,
      ).toBe(true);
    }
    expect(J1OutputSchema.safeParse({ verdict: "maybe" }).success).toBe(false);
  });

  test("J2 accepts every friction_cause branch and bounds turn_friction to 0..1", () => {
    for (const friction_cause of [
      "system_failure",
      "capability_gap",
      "agent_behavior",
      "user_request",
      "none",
    ] as const) {
      expect(
        J2OutputSchema.safeParse({
          turn_friction: 0.5,
          friction_cause,
          linked_signature_pattern: friction_cause === "system_failure" ? "portal-auth-403" : null,
          is_correction: false,
          verdict: "ok",
          insufficient_reason: null,
          evidence: "one sentence",
        }).success,
      ).toBe(true);
    }
    expect(J2OutputSchema.safeParse({ turn_friction: 1.2 }).success).toBe(false);
  });

  test("J3 keeps undetermined (judgment) distinct from insufficient (abstention)", () => {
    const base = {
      job_type: "tie_out",
      job_type_secondary: null,
      outcome_evidence: "turns 3-4",
      ended_mid_work: false,
      insufficient_reason: null,
    };
    expect(
      J3OutputSchema.safeParse({ ...base, outcome: "undetermined", verdict: "ok" }).success,
    ).toBe(true);
    expect(
      J3OutputSchema.safeParse({
        ...base,
        outcome: "undetermined",
        verdict: "insufficient",
        insufficient_reason: "unreadable_context",
      }).success,
    ).toBe(true);
    expect(J3OutputSchema.safeParse({ ...base, outcome: "killed", verdict: "ok" }).success).toBe(
      false,
    );
  });

  test("J4 and J5 shapes", () => {
    expect(
      J4OutputSchema.safeParse({
        display_name: "Browser grind for portal downloads",
        description: "auditors hand-drive the browser where a connector should exist",
        exemplar_session_ids: ["9b58b0bc-0000"],
        verdict: "ok",
        insufficient_reason: null,
      }).success,
    ).toBe(true);
    for (const assessment of [
      "missed_failure",
      "correct",
      "false_positive",
      "insufficient",
    ] as const) {
      expect(
        J5OutputSchema.safeParse({
          assessment,
          insufficient_reason: assessment === "insufficient" ? "unreadable_context" : null,
          evidence: "snippet read",
        }).success,
      ).toBe(true);
    }
  });
});

describe("manifest recorder snapshot", () => {
  test("accumulated entries validate against RunManifestSchema", () => {
    const rec = new ManifestRecorder(
      "20260401T000000-abcd1234",
      "2026-04-01T00:00:00.000Z",
      { "traces.jsonl": "aa", "observations.jsonl": "bb" },
      { "signatures.yaml": "cc" },
      { version: "thr-v0" },
      "unused-dir",
      null,
    );
    rec.recordStage(
      "s0_raw",
      { "raw.traces": 55 },
      [{ gate: "raw_spot_check", passed: true, detail: null }],
      12,
    );
    rec.recordEnrichment("J1", { judged: 3, abstained: 1, error: 0, cached_hit: 2 }, "m", "j1-v0");
    const snap = rec.snapshot();
    expect(snap.run_id).toBe("20260401T000000-abcd1234");
    expect(snap.stages).toHaveLength(1);
    expect(snap.enrichment.J1?.judged).toBe(3);
    expect(snap.model_ids.J1).toBe("m");
  });
});
