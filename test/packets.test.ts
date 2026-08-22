// Pure packet-builder tests (docs/plans/etl.md §6: byte-stable output for a
// fixed input; truncation edge cases; skip semantics from the llm.md
// escape-hatch table). The builders are pure functions, so these are direct
// unit tests — the runner-level zero-spend consequences are asserted in
// llm_matrix.test.ts. RED until packets.ts is implemented.

import { describe, expect, test } from "bun:test";
import { sha256Object } from "../etl/lib/hash.ts";
import { buildJ1Packet, buildJ3Packet, TRUNCATION } from "../etl/stages/s3_enrich/packets.ts";

const j1Row: Record<string, unknown> = {
  observation_id: "0e71739488c361af",
  tool_name: "AskUserQuestion",
  matched_signature_id: "askuserquestion-exit-1",
  output_text: "Error: operation failed (exit 1)",
  seq_index: 2,
  following_tools: [
    { tool_name: "Bash", matched: false },
    { tool_name: "Read", matched: false },
  ],
  assistant_tail: "I'll wait for your choice before proceeding.",
};

describe("packet builders are pure and deterministic", () => {
  test("J1: identical input rows produce byte-identical packets (cache correctness)", () => {
    const a = buildJ1Packet(structuredClone(j1Row));
    const b = buildJ1Packet(structuredClone(j1Row));
    expect(a.kind).toBe("packet");
    if (a.kind !== "packet" || b.kind !== "packet") throw new Error("expected packets");
    expect(sha256Object(a.packet)).toBe(sha256Object(b.packet));
  });

  test("J1: a missing load-bearing output yields a missing_source_field skip (zero-spend contract)", () => {
    const { output_text: _dropped, ...rest } = j1Row;
    const result = buildJ1Packet(rest);
    expect(result.kind).toBe("skip");
    if (result.kind !== "skip") throw new Error("expected skip");
    expect(result.reason).toBe("missing_source_field");
    expect(result.detail).toContain("output");
  });

  test("J3: a pathological session overflows the budget even after second-level elision", () => {
    // 76 turns of budget-busting digests — the elision keeps first 3 + last 10
    // + friction/failure turns; with every turn oversized and unmarked, the
    // packet must come back as an explicit packet_overflow skip, never a
    // truncated-by-silence packet.
    const digest = "x".repeat(TRUNCATION.contextBudgetTokens);
    const row: Record<string, unknown> = {
      session_id: "b3834869-like-pathological",
      resumed_fragment: false,
      turns: Array.from({ length: 76 }, (_, i) => ({
        turn_number: i + 1,
        typed_prefix: digest,
        assistant_tail: digest,
        tool_families: ["shell"],
        friction: null,
      })),
    };
    const result = buildJ3Packet(row);
    expect(result.kind).toBe("skip");
    if (result.kind !== "skip") throw new Error("expected skip");
    expect(result.reason).toBe("packet_overflow");
  });

  test("J3: elision notes the dropped-turn count in the packet for a large-but-fittable session", () => {
    const row: Record<string, unknown> = {
      session_id: "large-but-ok",
      resumed_fragment: true,
      turns: Array.from({ length: 40 }, (_, i) => ({
        turn_number: i + 22,
        typed_prefix: `turn ${i} short ask`,
        assistant_tail: "done.",
        tool_families: ["file"],
        friction: null,
      })),
    };
    const result = buildJ3Packet(row);
    expect(result.kind).toBe("packet");
    if (result.kind !== "packet") throw new Error("expected packet");
    // resumed_fragment must ride along (llm.md escape hatch: judged from the tail).
    expect(JSON.stringify(result.packet)).toContain("resumed_fragment");
  });
});

describe("truncation constants are versioned data", () => {
  test("TRUNCATION is frozen and carries its version (cache-poisoning guard)", () => {
    expect(Object.isFrozen(TRUNCATION)).toBe(true);
    expect(TRUNCATION.version).toMatch(/^trunc-v\d+$/);
    expect(TRUNCATION.elisionKeepHead).toBe(3);
    expect(TRUNCATION.elisionKeepTail).toBe(10);
  });
});
