// Stage 2 — DERIVE: row-level facts only. Pure SQL + rule application; no
// network, no models, no aggregation (aggregation is stage 4, deliberately
// downstream of enrichment).
// Inputs: clean.* + rule temp tables (signatures, tool_families — injected by
// prepare(), never string-spliced into the SQL). Outputs: derive.tool_events,
// derive.turns, derive.sessions. Includes enrichment candidate flags
// (short_typed_after_short_gap, J1 selector, seeded J5 samples).
// The two sanctioned TS row passes (docs/plans/etl.md §2) live in prepare():
// signature regex application (JS RegExp — the patterns use lookahead guards
// RE2 lacks) and marker-flag/typed-prefix scanning; both feed temp tables the
// SQL joins against, so the compiled ruleset in lib/signatures.ts stays the
// single matching implementation.
// Contract: docs/architecture/etl.md "Stage 2 — DERIVE"; every field is a
// derivations.md entry marked structural/heuristic/curated. This is where the
// unit tests concentrate.

import type { RunContext } from "../context.ts";
import { countRows, exec, queryRows, sqlString } from "../lib/duckdb.ts";
import { batchInsert, installSignatureRules, installToolFamilies } from "../lib/rule_tables.ts";
import { compileSignatures, matchSignatures } from "../lib/signatures.ts";
import type { Stage } from "./types.ts";

async function prepare(ctx: RunContext): Promise<void> {
  const compiled = compileSignatures(ctx.rules.signatures);

  await installSignatureRules(ctx);
  await installToolFamilies(ctx);

  // Signature regex application over tool outputs (unwrapped text form).
  // One chosen match per event: rules filtered by tool_scope/target, first in
  // rule-file order wins — deterministic, and scoping keeps the gray-zone
  // rules (askuserquestion-exit-1, agent-generic-error) off other tools.
  const toolRules = compiled.signatures.filter((s) => s.rule.target === "tool_output");
  const events = await queryRows(
    ctx.db,
    `SELECT observation_id, tool_name, output_text FROM clean.observations WHERE type = 'TOOL'`,
  );
  await exec(
    ctx.db,
    `CREATE OR REPLACE TEMP TABLE _sig_matches (
       observation_id VARCHAR, pattern_id VARCHAR, counts_as_failure VARCHAR,
       match_index INTEGER, matched_text VARCHAR)`,
  );
  const matchRows: string[] = [];
  for (const e of events) {
    const text =
      e.output_text === null || e.output_text === undefined ? null : String(e.output_text);
    if (text === null) continue;
    const toolName = e.tool_name === null ? null : String(e.tool_name);
    const inScope = {
      version: compiled.version,
      signatures: toolRules.filter(
        (s) =>
          s.rule.tool_scope === null || (toolName !== null && s.rule.tool_scope.includes(toolName)),
      ),
    };
    const hit = matchSignatures(inScope, text)[0];
    if (hit) {
      matchRows.push(
        `(${sqlString(String(e.observation_id))}, ${sqlString(hit.patternId)}, ${sqlString(
          String(hit.countsAsFailure),
        )}, ${hit.matchIndex}, ${sqlString(hit.matchedText.slice(0, 500))})`,
      );
    }
  }
  await batchInsert(ctx, "_sig_matches", matchRows);

  // Marker flags + typed prefix + assistant-output platform-limit marker.
  const markers = ctx.rules.thresholds.markers;
  const markerList = [markers.task_notification, markers.skill_body, markers.extract_paste];
  const assistantRules = {
    version: compiled.version,
    signatures: compiled.signatures.filter((s) => s.rule.target === "assistant_output"),
  };
  const turns = await queryRows(
    ctx.db,
    `SELECT trace_id, user_content, assistant_content FROM clean.turns`,
  );
  await exec(
    ctx.db,
    `CREATE OR REPLACE TEMP TABLE _turn_marks (
       trace_id VARCHAR, has_task_notification BOOLEAN, has_skill_body BOOLEAN,
       has_extract_paste BOOLEAN, typed_prefix_chars INTEGER,
       platform_limit_marker BOOLEAN)`,
  );
  const markRows: string[] = [];
  for (const t of turns) {
    const user =
      t.user_content === null || t.user_content === undefined ? "" : String(t.user_content);
    const assistant =
      t.assistant_content === null || t.assistant_content === undefined
        ? ""
        : String(t.assistant_content);
    const positions = markerList.map((m) => user.indexOf(m));
    const present = positions.filter((p) => p >= 0);
    const typedPrefix = present.length === 0 ? user.length : Math.min(...present);
    const platformLimit = matchSignatures(assistantRules, assistant).length > 0;
    markRows.push(
      `(${sqlString(String(t.trace_id))}, ${positions[0] !== undefined && positions[0] >= 0}, ${
        positions[1] !== undefined && positions[1] >= 0
      }, ${positions[2] !== undefined && positions[2] >= 0}, ${typedPrefix}, ${platformLimit})`,
    );
  }
  await batchInsert(ctx, "_turn_marks", markRows);
}

export const s2Derive: Stage = {
  name: "s2_derive",
  schema: "derive",
  sqlFiles: ["s2_tool_events", "s2_turns", "s2_sessions"],
  preGates: [],
  postGates: [],
  prepare,
  async rowCounts(ctx: RunContext) {
    return {
      "derive.tool_events": await countRows(ctx.db, "derive.tool_events"),
      "derive.turns": await countRows(ctx.db, "derive.turns"),
      "derive.sessions": await countRows(ctx.db, "derive.sessions"),
    };
  },
};
