// Regenerates every checked-in fixture under test/fixtures/ from the real
// dataset (docs/plans/etl_testing.md §6: fixtures are checked in, never
// generated at test time; regeneration is this script, its diff reviewed like
// code). Run: `bun run fixtures:rebuild`.
//
// Selection is deterministic: golden cases are pinned by observation id
// (verified present in data/observations.jsonl), slice sessions by session-id
// prefix. If the dataset changes, this script fails loudly rather than
// silently picking different rows.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const outDir = import.meta.dir;

interface Trace {
  id: string;
  timestamp: string;
  output?: { content?: string } | null;
  observations: string[];
  metadata: { session_id: string; turn_number: number; client: string };
}
interface Obs {
  id: string;
  traceId: string;
  type: string;
  output?: unknown;
  metadata?: { tool_name?: string } | null;
}

const readJsonl = async (p: string): Promise<{ raw: string; row: unknown }[]> =>
  (await Bun.file(p).text())
    .trim()
    .split("\n")
    .map((raw) => ({ raw, row: JSON.parse(raw) }));

const traces = await readJsonl(join(root, "data", "traces.jsonl"));
const observations = await readJsonl(join(root, "data", "observations.jsonl"));
const traceRows = traces.map((t) => t.row as Trace);
const obsById = new Map(observations.map((o) => [(o.row as Obs).id, o]));
const traceById = new Map(traces.map((t) => [(t.row as Trace).id, t]));
const obsByTrace = new Map<string, typeof observations>();
for (const o of observations) {
  const tid = (o.row as Obs).traceId;
  if (!obsByTrace.has(tid)) obsByTrace.set(tid, []);
  obsByTrace.get(tid)?.push(o);
}
const outText = (o: Obs): string =>
  typeof o.output === "string" ? o.output : o.output == null ? "" : JSON.stringify(o.output);

// ---------------------------------------------------------------------------
// Golden snippet cases — each named trap pinned to a real row.
// ---------------------------------------------------------------------------

interface GoldenCase {
  name: string;
  source: { kind: "observation" | "trace_output" | "synthetic"; id: string | null };
  tool_name: string | null;
  text: string;
  expected: { pattern_id: string | null; counts_as_failure: boolean | "uncertain" | null };
  note: string;
}

const obsCase = (
  name: string,
  id: string,
  expected: GoldenCase["expected"],
  note: string,
): GoldenCase => {
  const o = obsById.get(id)?.row as Obs | undefined;
  if (!o) throw new Error(`golden case ${name}: observation ${id} not found in dataset`);
  return {
    name,
    source: { kind: "observation", id },
    tool_name: o.metadata?.tool_name ?? null,
    text: outText(o),
    expected,
    note,
  };
};

// Platform-limit marker lives on ASSISTANT output — pick the first marker turn
// of the dedicated slice session (see slice selection below).
const LIMIT_MARKER = "you have hit your org's monthly spend limit";
const limitSession = "7ab6b10b";
const limitTrace = traceRows
  .filter(
    (t) =>
      t.metadata.session_id.startsWith(limitSession) &&
      (t.output?.content ?? "").includes(LIMIT_MARKER),
  )
  .sort((a, b) => a.metadata.turn_number - b.metadata.turn_number)[0];
if (!limitTrace) throw new Error("platform-limit trace not found");

const golden: GoldenCase[] = [
  obsCase(
    "amount_403_must_not_match",
    "0650f74e1e88da5a",
    { pattern_id: null, counts_as_failure: null },
    "Bash output containing $69,403,439.86 — the digit run '403' inside a monetary amount must NOT match portal-auth-403. The anchoring trap from README/signatures.yaml.",
  ),
  obsCase(
    "portal_auth_403_matches",
    "00f102eb3af7c231",
    { pattern_id: "portal-auth-403", counts_as_failure: true },
    "Genuine 'portal returned HTTP 403: connector is not configured' template.",
  ),
  obsCase(
    "askuserquestion_exit1_uncertain",
    "0e71739488c361af",
    { pattern_id: "askuserquestion-exit-1", counts_as_failure: "uncertain" },
    "AskUserQuestion output 'Error: operation failed (exit 1)' — the canonical gray-zone case; plausibly the user declining. NOTE: the real template says 'exit 1', while signatures.yaml currently anchors on 'exit code 1' — this golden case exists to force that reconciliation in the implementation phase.",
  ),
  obsCase(
    "agent_generic_error",
    "827283e0ad841735",
    { pattern_id: "agent-generic-error", counts_as_failure: "uncertain" },
    "Agent tool near-uniform failure template (JSON-list output whose text block is 'Error: operation failed (exit 1)') — must stay uncertain / excludable (is_agent_tool), never a plain failure.",
  ),
  obsCase(
    "portal_token_missing",
    "05adf06f7f179f4a",
    { pattern_id: "portal-token-missing", counts_as_failure: true },
    "'no portal token found' verbatim template phrase (SCHEMA.md).",
  ),
  obsCase(
    "cli_command_not_found",
    "00f88605a13f7439",
    { pattern_id: "cli-command-not-found", counts_as_failure: true },
    "'bash: line 1: search: command not found' — the unprovisioned-CLI class.",
  ),
  obsCase(
    "missing_file_read",
    "011f7914941e2777",
    { pattern_id: "missing-file", counts_as_failure: true },
    "grep 'No such file or directory' on a corpus path — missing_resource class.",
  ),
  obsCase(
    "python_traceback",
    "00c992d9c6771fd6",
    { pattern_id: "python-traceback", counts_as_failure: true },
    "'Traceback (most recent call last)' — agent-written code crash.",
  ),
  {
    name: "platform_limit_marker",
    source: { kind: "trace_output", id: limitTrace.id },
    tool_name: null,
    text: limitTrace.output?.content ?? "",
    expected: { pattern_id: "platform-limit", counts_as_failure: "uncertain" },
    note: "Assistant-output marker (turn.platform_limit_marker), not a tool output — whether it ended the session is interpretation.",
  },
  {
    name: "http_5xx_synthetic",
    source: { kind: "synthetic", id: null },
    tool_name: "Bash",
    text: "portal returned HTTP 502: upstream connector unavailable.\nTotal fair value $12,502,118.00 unchanged.",
    expected: { pattern_id: "tool-http-5xx", counts_as_failure: true },
    note: "SYNTHETIC: no real 5xx exemplar exists in this dataset (a rule-file gap worth revisiting); the amount on line 2 doubles as a 5xx anchoring trap.",
  },
];

mkdirSync(join(outDir, "golden"), { recursive: true });
await Bun.write(join(outDir, "golden", "snippets.json"), `${JSON.stringify(golden, null, 2)}\n`);

// Golden staged JSONL: the full trace + observations of every turn containing a
// golden row, so each trap is also asserted as a row in derive.tool_events
// after a real s0–s2 run (docs/plans/etl_testing.md §6).
const goldenTraceIds = new Set<string>();
for (const g of golden) {
  if (g.source.kind === "observation" && g.source.id) {
    const row = obsById.get(g.source.id)?.row as Obs | undefined;
    if (!row) throw new Error(`golden staged: observation ${g.source.id} missing`);
    goldenTraceIds.add(row.traceId);
  }
  if (g.source.kind === "trace_output" && g.source.id) goldenTraceIds.add(g.source.id);
}
const goldenTraces = [...goldenTraceIds]
  .map((id) => {
    const t = traceById.get(id);
    if (!t) throw new Error(`golden staged: trace ${id} missing`);
    return t;
  })
  .sort((a, b) => ((a.row as Trace).id < (b.row as Trace).id ? -1 : 1));
const goldenObs = goldenTraces.flatMap((t) => obsByTrace.get((t.row as Trace).id) ?? []);
mkdirSync(join(outDir, "golden", "staged"), { recursive: true });
await Bun.write(
  join(outDir, "golden", "staged", "traces.jsonl"),
  `${goldenTraces.map((t) => t.raw).join("\n")}\n`,
);
await Bun.write(
  join(outDir, "golden", "staged", "observations.jsonl"),
  `${goldenObs.map((o) => o.raw).join("\n")}\n`,
);

// ---------------------------------------------------------------------------
// The 5-session slice (docs/plans/etl_testing.md §6).
// ---------------------------------------------------------------------------

const SLICE_SESSIONS: { prefix: string; why: string }[] = [
  {
    prefix: "49d43953",
    why: "the resumed-fragment session (turns 22-59, telemetry-truncated head)",
  },
  { prefix: "7ab6b10b", why: "platform-limit session (org-spend-limit marker, 7 turns)" },
  { prefix: "9b58b0bc", why: "browser-heavy session (~88% chrome tool calls of 108)" },
  { prefix: "327038b2", why: "clean single-turn session (no signature-shaped output)" },
  {
    prefix: "eaec5bef",
    why: "enrichment-abstention candidate (contains observations with missing output)",
  },
];

const sliceIds = SLICE_SESSIONS.map(({ prefix }) => {
  const ids = [...new Set(traceRows.map((t) => t.metadata.session_id))].filter((s) =>
    s.startsWith(prefix),
  );
  if (ids.length !== 1) throw new Error(`slice session prefix ${prefix}: ${ids.length} matches`);
  return ids[0] as string;
});
const sliceIdSet = new Set(sliceIds);
const sliceTraces = traces
  .filter((t) => sliceIdSet.has((t.row as Trace).metadata.session_id))
  .sort((a, b) => ((a.row as Trace).id < (b.row as Trace).id ? -1 : 1));
const sliceObs = sliceTraces.flatMap((t) => obsByTrace.get((t.row as Trace).id) ?? []);
mkdirSync(join(outDir, "slice"), { recursive: true });
await Bun.write(
  join(outDir, "slice", "traces.jsonl"),
  `${sliceTraces.map((t) => t.raw).join("\n")}\n`,
);
await Bun.write(
  join(outDir, "slice", "observations.jsonl"),
  `${sliceObs.map((o) => o.raw).join("\n")}\n`,
);

// Expectations: one entry per asserted value, each with provenance. status
// "verified" = computed deterministically from the raw fixture rows by this
// script; "estimated" = best raw-data estimate, pending the real pipeline
// semantics (TODO-implementation).
interface Expectation {
  metric: string;
  session: string | null;
  value: unknown;
  status: "verified" | "estimated";
  provenance: string;
}
const expectations: Expectation[] = [];
const push = (
  metric: string,
  session: string | null,
  value: unknown,
  status: Expectation["status"],
  provenance: string,
) => expectations.push({ metric, session, value, status, provenance });

push("slice.trace_count", null, sliceTraces.length, "verified", "line count of slice/traces.jsonl");
push(
  "slice.observation_count",
  null,
  sliceObs.length,
  "verified",
  "line count of slice/observations.jsonl",
);
push(
  "slice.tool_event_count",
  null,
  sliceObs.filter((o) => (o.row as Obs).type === "TOOL").length,
  "verified",
  "count of TOOL observations — expected rows in derive.tool_events (assuming 1 row per TOOL observation)",
);
push(
  "slice.session_ids",
  null,
  [...sliceIds].sort(),
  "verified",
  "the five selected sessions; expected rows in derive.sessions / ref/sessions",
);
const days = new Set(sliceTraces.map((t) => ((t.row as Trace).timestamp ?? "").slice(0, 10)));
push(
  "slice.event_days",
  null,
  [...days].sort(),
  "verified",
  "distinct UTC dates of trace timestamps — the expected fact-plane partition set (facts/turns/day=<date>.parquet)",
);
for (const sid of sliceIds) {
  const ts = traceRows
    .filter((t) => t.metadata.session_id === sid)
    .sort((a, b) => a.metadata.turn_number - b.metadata.turn_number);
  const short = sid.slice(0, 8);
  push(`session.turn_count`, sid, ts.length, "verified", `trace rows with session_id ${short}`);
  const nums = ts.map((t) => t.metadata.turn_number);
  push(
    "session.resumed_fragment",
    sid,
    Math.min(...nums) > 1,
    "verified",
    "turn numbering starts above 1 (derivations.md §3)",
  );
  const sorted = ts.map((t) => t.timestamp).sort();
  push("session.first_ts", sid, sorted[0], "verified", "min trace timestamp");
  push("session.last_ts", sid, sorted[sorted.length - 1], "verified", "max trace timestamp");
  push(
    "session.platform_limit_turns",
    sid,
    ts.filter((t) => (t.output?.content ?? "").includes(LIMIT_MARKER)).length,
    "verified",
    "turns whose assistant output contains the org-spend-limit marker verbatim",
  );
  push(
    "session.missing_output_observations",
    sid,
    ts.flatMap((t) => obsByTrace.get(t.id) ?? []).filter((o) => (o.row as Obs).output == null)
      .length,
    "verified",
    "observations with null/absent output (output_missing flag inputs; abstention candidates)",
  );
}
// Estimated: raw regex hits of the provisional rule patterns over slice TOOL
// outputs. TODO-implementation: the pipeline's anchored per-event semantics
// (first match per signature per event, text extraction from non-string
// outputs) may legitimately differ — reconcile when stage 2 lands.
const provisional: [string, RegExp][] = [
  ["portal-auth-403", /(?:^|\n)\s*(?:HTTP\s*)?403\b|\bHTTP 403\b/],
  ["portal-token-missing", /no portal token found/],
  ["cli-command-not-found", /command not found/],
  ["missing-file", /No such file or directory/],
  ["python-traceback", /Traceback \(most recent call last\)/],
];
for (const [pid, re] of provisional) {
  const n = sliceObs.filter(
    (o) => (o.row as Obs).type === "TOOL" && re.test(outText(o.row as Obs)),
  ).length;
  push(
    `slice.signature_event_estimate.${pid}`,
    null,
    n,
    "estimated",
    "TOOL observations whose stringified output matches the provisional pattern — an upper-bound estimate for matched_signature_id counts",
  );
}
await Bun.write(
  join(outDir, "slice", "expectations.json"),
  `${JSON.stringify(expectations, null, 2)}\n`,
);

// ---------------------------------------------------------------------------
// Synthetic violation fixtures — hand-built minimal JSONL, small enough to read.
// ---------------------------------------------------------------------------

const hex32 = (n: number) => n.toString(16).padStart(32, "0");
const hex16 = (n: number) => n.toString(16).padStart(16, "0");
const mkTrace = (
  n: number,
  session: string,
  turn: number,
  ts: string,
  user: string,
  extra?: Record<string, unknown>,
) => ({
  id: hex32(n),
  name: `Turn ${turn}`,
  timestamp: ts,
  input: { role: "user", content: user },
  output: { role: "assistant", content: `ack turn ${turn}` },
  metadata: {
    session_id: session,
    turn_number: turn,
    client: "harborline",
    entity: "fund-i",
    linux_user: "rowan",
    auditor_email: "rowan@example-audit.test",
    source: "claude-code",
  },
  observations: [hex16(n)],
  ...extra,
});
const mkObs = (n: number, traceId: string, turn: number) => ({
  id: hex16(n),
  traceId,
  type: "SPAN",
  name: `Turn ${turn}`,
  input: { role: "user", content: "envelope" },
  output: "ok",
  metadata: {},
  parentObservationId: null,
});
const writeSet = async (dir: string, ts: unknown[], os: unknown[]) => {
  mkdirSync(join(outDir, "violations", dir), { recursive: true });
  await Bun.write(
    join(outDir, "violations", dir, "traces.jsonl"),
    `${ts.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
  await Bun.write(
    join(outDir, "violations", dir, "observations.jsonl"),
    `${os.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
};

// Fork: two sessions, same auditor+client, overlapping turn-number ranges in
// overlapping wall-clock windows (derivations.md §3 fork detector → abort).
{
  const sA = "aaaaaaaa-0000-0000-0000-000000000001";
  const sB = "bbbbbbbb-0000-0000-0000-000000000002";
  const ts = [
    mkTrace(1, sA, 1, "2026-03-01T10:00:00.000Z", "start A"),
    mkTrace(2, sA, 2, "2026-03-01T10:10:00.000Z", "continue A"),
    mkTrace(3, sB, 1, "2026-03-01T10:05:00.000Z", "start B (forked from A)"),
    mkTrace(4, sB, 2, "2026-03-01T10:12:00.000Z", "continue B"),
    mkTrace(5, sA, 3, "2026-03-01T10:20:00.000Z", "A again"),
  ];
  await writeSet(
    "fork",
    ts,
    ts.map((t, i) => mkObs(i + 1, t.id, t.metadata.turn_number)),
  );
}

// Referential: one observation points at a traceId that does not exist.
{
  const s = "cccccccc-0000-0000-0000-000000000003";
  const ts = [mkTrace(10, s, 1, "2026-03-02T09:00:00.000Z", "only turn")];
  const os = [
    mkObs(10, hex32(10), 1),
    {
      ...mkObs(11, hex32(999), 1),
      type: "TOOL",
      name: "Tool: Bash",
      metadata: { tool_name: "Bash" },
    },
  ];
  await writeSet("referential", ts, os);
}

// Timestamp edges: equal timestamps on adjacent turns, timestamp order
// disagreeing with turn order, a single-turn session, and a gap exactly at the
// gap cap (thresholds.yaml gap_cap_s = 1800). These must NOT abort — they feed
// the gap-arithmetic assertions.
{
  const s1 = "dddddddd-0000-0000-0000-000000000004";
  const s2 = "eeeeeeee-0000-0000-0000-000000000005";
  const ts = [
    mkTrace(20, s1, 1, "2026-03-03T08:00:00.000Z", "t1"),
    mkTrace(21, s1, 2, "2026-03-03T08:00:00.000Z", "t2 equal timestamp"),
    mkTrace(22, s1, 3, "2026-03-03T07:59:00.000Z", "t3 timestamp before t2"),
    mkTrace(23, s1, 4, "2026-03-03T08:30:00.000Z", "t4 gap exactly 1800s from t1/t2"),
    mkTrace(24, s2, 1, "2026-03-04T12:00:00.000Z", "single-turn session"),
  ];
  await writeSet(
    "timestamps",
    ts,
    ts.map((t, i) => mkObs(20 + i, t.id, t.metadata.turn_number)),
  );
}

process.stdout.write(
  `${JSON.stringify({
    golden_cases: golden.length,
    golden_staged_traces: goldenTraces.length,
    slice_traces: sliceTraces.length,
    slice_observations: sliceObs.length,
    expectations: expectations.length,
  })}\n`,
);
