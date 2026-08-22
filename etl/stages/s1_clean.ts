// Stage 1 — CLEAN: validation, integrity gates, identity flags.
// Inputs: raw.*. Outputs: clean.turns, clean.observations.
// Gates: referential (observations.traceId ⊆ traces.id; traces.observations id
// lists consistent) and the FORK gate (overlapping turn-number ranges per
// (auditor, client) → ABORT the run with a report; zero expected on this data).
// Flags: resumed_fragment, missing_turns, output_missing, usage_missing,
// is_demo_traffic (client = tealstone OR user = demo — NOT the same set).
// Contract: docs/architecture/etl.md "Stage 1 — CLEAN".

import type { RunContext } from "../context.ts";
import { countRows, queryRows } from "../lib/duckdb.ts";
import type { Gate, Stage } from "./types.ts";

/** Pre-gate over raw.*: every observation's traceId exists, and every id in a
 * trace's observations list resolves to a real observation. */
const referentialGate: Gate = {
  name: "referential_integrity",
  async evaluate(ctx: RunContext) {
    const dangling = await queryRows(
      ctx.db,
      `SELECT COUNT(*) AS n FROM raw.observations o
       LEFT JOIN raw.traces t ON t.id = o.traceId
       WHERE t.id IS NULL`,
    );
    const unresolved = await queryRows(
      ctx.db,
      `SELECT COUNT(*) AS n FROM (
         SELECT unnest(observations) AS obs_id FROM raw.traces
       ) listed
       LEFT JOIN raw.observations o ON o.id = listed.obs_id
       WHERE o.id IS NULL`,
    );
    const nDangling = Number(dangling[0]?.n ?? 0);
    const nUnresolved = Number(unresolved[0]?.n ?? 0);
    const passed = nDangling === 0 && nUnresolved === 0;
    return {
      gate: "referential_integrity",
      passed,
      detail: passed
        ? null
        : `${nDangling} observation(s) with unknown traceId; ${nUnresolved} listed observation id(s) with no observation row`,
    };
  },
};

/** Post-gate: two sessions of the same (auditor, client) whose turn-number
 * ranges AND wall-clock windows overlap — the fork shape (derivations.md §3
 * rejected-entity note). Zero expected; any hit aborts the run. */
const forkGate: Gate = {
  name: "fork_detector",
  async evaluate(ctx: RunContext) {
    const forks = await queryRows(
      ctx.db,
      `WITH s AS (
         SELECT session_id, linux_user, client,
                MIN(turn_number) AS tmin, MAX(turn_number) AS tmax,
                MIN(timestamp) AS wmin, MAX(timestamp) AS wmax
         FROM clean.turns GROUP BY session_id, linux_user, client
       )
       SELECT a.session_id AS a_id, b.session_id AS b_id
       FROM s a JOIN s b
         ON a.linux_user = b.linux_user AND a.client = b.client
        AND a.session_id < b.session_id
       WHERE a.tmin <= b.tmax AND b.tmin <= a.tmax
         AND a.wmin < b.wmax AND b.wmin < a.wmax`,
    );
    const passed = forks.length === 0;
    return {
      gate: "fork_detector",
      passed,
      detail: passed
        ? null
        : `overlapping turn ranges + time windows for same auditor+client: ${forks
            .map((f) => `${String(f.a_id).slice(0, 8)}~${String(f.b_id).slice(0, 8)}`)
            .join(", ")}`,
    };
  },
};

export const s1Clean: Stage = {
  name: "s1_clean",
  schema: "clean",
  sqlFiles: ["s1_turns", "s1_observations"],
  preGates: [referentialGate],
  postGates: [forkGate],
  async rowCounts(ctx: RunContext) {
    return {
      "clean.turns": await countRows(ctx.db, "clean.turns"),
      "clean.observations": await countRows(ctx.db, "clean.observations"),
    };
  },
};
