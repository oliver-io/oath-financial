// Stage 0 — RAW: data/*.jsonl → raw.traces, raw.observations, verbatim.
// Inputs: data/traces.jsonl, data/observations.jsonl. Outputs: raw.* tables.
// Gates: zod spot-validation of a sample per file (fail fast on schema drift).
// Contract: docs/architecture/etl.md "Stage 0 — RAW"; row schemas in
// etl/schemas/raw.ts.

import { join } from "node:path";
import type { RunContext } from "../context.ts";
import { countRows } from "../lib/duckdb.ts";
import { RawObservationSchema, RawTraceSchema } from "../schemas/raw.ts";
import type { Gate, Stage } from "./types.ts";

const SPOT_SAMPLE_LINES = 50;

async function spotCheckFile(
  path: string,
  schema: typeof RawTraceSchema | typeof RawObservationSchema,
): Promise<string | null> {
  const text = await Bun.file(path).text();
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  for (const [i, line] of lines.slice(0, SPOT_SAMPLE_LINES).entries()) {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      return `${path} line ${i + 1}: not valid JSON`;
    }
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      return `${path} line ${i + 1}: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`;
    }
  }
  return null;
}

const spotCheckGate: Gate = {
  name: "raw_spot_check",
  async evaluate(ctx: RunContext) {
    const dataDir = join(ctx.paths.root, "data");
    const problem =
      (await spotCheckFile(join(dataDir, "traces.jsonl"), RawTraceSchema)) ??
      (await spotCheckFile(join(dataDir, "observations.jsonl"), RawObservationSchema));
    return { gate: "raw_spot_check", passed: problem === null, detail: problem };
  },
};

export const s0Raw: Stage = {
  name: "s0_raw",
  schema: "raw",
  sqlFiles: ["s0_traces", "s0_observations"],
  preGates: [],
  postGates: [spotCheckGate],
  async rowCounts(ctx: RunContext) {
    return {
      "raw.traces": await countRows(ctx.db, "raw.traces"),
      "raw.observations": await countRows(ctx.db, "raw.observations"),
    };
  },
};
