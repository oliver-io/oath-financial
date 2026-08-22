// Pure context-packet builders + deterministic truncation.
// Contract: docs/architecture/llm.md "Context packets and schemas".
// WARNING (cache poisoning): packet builders are pure and their truncation
// constants are VERSIONED WITH THE PROMPT — changing any truncation rule
// without bumping the job's prompt_version silently invalidates nothing and
// poisons the cache (packet stability IS cache correctness). Bump the version.
// Packets embed stage-2 facts as structured JSON, never prose descriptions.
// Missing load-bearing fields → the builder returns a skip so the runner writes
// `insufficient / missing_source_field` with ZERO api spend; oversized packets
// go through structured elision then `insufficient / packet_overflow`.

import { Unimplemented } from "../../lib/errors.ts";

/** Shared truncation rules, versioned (llm.md "Context packets"). */
export const TRUNCATION = Object.freeze({
  version: "trunc-v1",
  /** user text: typed_prefix in full + first N chars of any pasted block, tagged. */
  pastedBlockHeadChars: 500,
  /** assistant text: first N + last M (endings carry outcome signal). */
  assistantHeadChars: 1000,
  assistantTailChars: 500,
  /** tool outputs: ±N chars around a signature match / first N for J1 gray-zone. */
  toolOutputSnippetChars: 300,
  /** per-call input context budget, approx tokens. */
  contextBudgetTokens: 20_000,
  /** second-level elision for pathological sessions: first 3 + last 10 turn
   * digests + all turns with friction/failure marks. */
  elisionKeepHead: 3,
  elisionKeepTail: 10,
});

/** A built packet, or a deterministic reason the call must be skipped. */
export type PacketResult =
  | { kind: "packet"; packet: Record<string, unknown>; missing: string[] }
  | { kind: "skip"; reason: "missing_source_field" | "packet_overflow"; detail: string };

/** Row → packet, pure. One builder per job; the runner hashes the result
 * (sha256Object) for the cache key. */
export type PacketBuilder = (row: Record<string, unknown>) => PacketResult;

export const buildJ1Packet: PacketBuilder = (_row) => {
  throw new Unimplemented("packets.buildJ1Packet", "docs/architecture/llm.md J1");
};

export const buildJ2Packet: PacketBuilder = (_row) => {
  throw new Unimplemented("packets.buildJ2Packet", "docs/architecture/llm.md J2");
};

export const buildJ3Packet: PacketBuilder = (_row) => {
  throw new Unimplemented("packets.buildJ3Packet", "docs/architecture/llm.md J3");
};

export const buildJ4Packet: PacketBuilder = (_row) => {
  throw new Unimplemented("packets.buildJ4Packet", "docs/architecture/llm.md J4");
};

export const buildJ5Packet: PacketBuilder = (_row) => {
  throw new Unimplemented("packets.buildJ5Packet", "docs/architecture/llm.md J5");
};
