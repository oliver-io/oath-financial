// The Stage contract shared by s0…s5 and executed by cli.ts.
// Contract: docs/plans/etl.md §3 Stage — name; ordered SQL files; optional
// pre/post gates (predicates over queries); post-run row-count report. The
// executor (cli.ts): drop stage schema → run files → run gates → record
// manifest → abort the sequence on any gate failure. Idempotence comes from
// drop-and-rebuild.

import type { RunContext } from "../context.ts";
import type { GateResult } from "../schemas/run_manifest.ts";

export interface Gate {
  readonly name: string;
  /** Evaluates the predicate against the pipeline database. */
  evaluate(ctx: RunContext): Promise<GateResult>;
}

export interface Stage {
  /** e.g. "s2_derive" */
  readonly name: string;
  /** DuckDB schema this stage owns and rebuilds, e.g. "derive". */
  readonly schema: string;
  /** Ordered file names under etl/stages/sql/ (without .sql), one per output table. */
  readonly sqlFiles: readonly string[];
  readonly preGates: readonly Gate[];
  readonly postGates: readonly Gate[];
  /** Optional TS hook run after the schema rebuild, before the SQL files:
   * installs rule temp tables and the sanctioned TS row passes (signature
   * regex application, marker flags — docs/plans/etl.md §2 exceptions). */
  prepare?(ctx: RunContext): Promise<void>;
  /** Row-count report for the manifest, keyed by table name. */
  rowCounts(ctx: RunContext): Promise<Record<string, number>>;
}
