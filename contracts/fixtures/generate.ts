// Fixture-pack generator — docs/plans/app.md §2.
// Emits synthetic `runs/<fixture-run-id>/` trees (manifest + partitions +
// reference files) shaped like the real dataset: skewed clients, a 76-turn
// session, a 131-call turn, a 46KB message, an incident window, undetermined/
// unclassified outcomes, and a degraded-mode variant with NULL model fields.
// Deterministic (seeded PRNG); rerun with `bun run fixtures` and review diffs.
// Every row is zod-validated against contracts/src before it is written.

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import type {
  AuditorTimelineRow,
  CapabilityGapRow,
  DimRow,
  FailureSignatureRow,
  FindingRow,
  FrictionCause,
  GapSessionRow,
  IncidentRow,
  JobType,
  SessionOutcome,
  SessionRow,
  ToolEventRow,
  TurnRow,
} from "../src/index.ts";
import {
  AuditorTimelineRowSchema,
  CapabilityGapRowSchema,
  DimRowSchema,
  encodeIntArray,
  encodeStringArray,
  encodeTargetParams,
  FailureSignatureRowSchema,
  FindingRowSchema,
  GapSessionRowSchema,
  IncidentRowSchema,
  type ServeManifest,
  ServeManifestSchema,
  SessionRowSchema,
  ToolEventRowSchema,
  TurnRowSchema,
} from "../src/index.ts";

// ---------------------------------------------------------------- world setup

const RUN_ID = "fixture-run-0001";
const RUN_ID_DEGRADED = "fixture-run-degraded";
const OUT_ROOT = join(import.meta.dir, "static", "runs");

const START_DAY = "2026-03-05";
const END_DAY = "2026-04-02";

const CLIENTS: Record<string, string[]> = {
  meridian: ["meridian-us", "meridian-emea"],
  harborlight: ["harborlight-core"],
  ashford: ["ashford-trust", "ashford-re"],
  tealstone: ["tealstone-demo"],
};
const AUDITORS = ["a.chen", "b.osei", "c.ivanov", "d.malik", "e.novak", "f.reyes", "g.sato"];

const JOB_TYPES: JobType[] = [
  "doc_receipt_check",
  "doc_location",
  "doc_inventory",
  "tie_out",
  "extraction_supervision",
  "drafting",
  "capability_probe",
  "other",
];

// tool pools per family (names from etl/rules/tool_families.yaml)
const TOOLS: Record<string, string[]> = {
  shell: ["Bash"],
  file: ["Read", "Edit", "Write"],
  browser: [
    "mcp__claude-in-chrome__computer",
    "mcp__claude-in-chrome__navigate",
    "mcp__claude-in-chrome__get_page_text",
    "mcp__claude-in-chrome__find",
  ],
  docstore: [
    "mcp__docstore__read_file_content",
    "mcp__docstore__search_files",
    "mcp__docstore__get_file_metadata",
  ],
  subagent: ["Agent"],
  task: ["TaskUpdate", "TaskCreate", "mcp__clickup__clickup_get_task"],
  search: ["ToolSearch", "WebFetch"],
  other: ["AskUserQuestion", "Skill", "SendUserFile"],
};
const FAMILIES = Object.keys(TOOLS);

interface SigSpec {
  pattern_id: string;
  display_name: string;
  signature_class: FailureSignatureRow["signature_class"];
  counts_as_failure: FailureSignatureRow["counts_as_failure"];
  family: string;
  snippet: string;
}
const SIGS: SigSpec[] = [
  {
    pattern_id: "portal-auth-403",
    display_name: "portal HTTP 403 — connector not configured",
    signature_class: "auth_token",
    counts_as_failure: "true",
    family: "browser",
    snippet: "…request rejected: HTTP 403 Forbidden — portal connector is not configured for…",
  },
  {
    pattern_id: "portal-token-missing",
    display_name: "no portal token found",
    signature_class: "auth_token",
    counts_as_failure: "true",
    family: "browser",
    snippet: "…authentication step failed: no portal token found for this workspace…",
  },
  {
    pattern_id: "cli-command-not-found",
    display_name: "command not found — unprovisioned CLI",
    signature_class: "provisioning_config",
    counts_as_failure: "true",
    family: "shell",
    snippet: "bash: tieout-cli: command not found",
  },
  {
    pattern_id: "missing-file",
    display_name: "referenced file/resource not found",
    signature_class: "missing_resource",
    counts_as_failure: "true",
    family: "file",
    snippet: "cat: /mnt/engagements/Q1/receipts_batch_07.csv: No such file or directory",
  },
  {
    pattern_id: "tool-http-5xx",
    display_name: "platform tool HTTP 5xx",
    signature_class: "platform_tool_fault",
    counts_as_failure: "true",
    family: "docstore",
    snippet: "…upstream returned HTTP 502 while fetching the document listing…",
  },
  {
    pattern_id: "python-traceback",
    display_name: "agent-written code crashed (traceback)",
    signature_class: "agent_code_crash",
    counts_as_failure: "true",
    family: "shell",
    snippet: "Traceback (most recent call last):\n  File 'reconcile.py', line 42, in <module>…",
  },
  {
    pattern_id: "agent-generic-error",
    display_name: "subagent generic error template",
    signature_class: "subagent_failure",
    counts_as_failure: "uncertain",
    family: "subagent",
    snippet: "Error: the subagent terminated without producing a final report",
  },
  {
    pattern_id: "askuserquestion-exit-1",
    display_name: "AskUserQuestion exited 1 — plausibly user declined",
    signature_class: "platform_tool_fault",
    counts_as_failure: "uncertain",
    family: "other",
    snippet: "AskUserQuestion returned exit code 1",
  },
];
const SIG_BY_ID = new Map(SIGS.map((s) => [s.pattern_id, s]));
const RULE_VERSION = "sig-v0";

const GAP_CAP_S = 1800;
const INCIDENT_START = "2026-03-29";
const INCIDENT_END = "2026-03-31";

// ------------------------------------------------------------------ utilities

// mulberry32 — deterministic PRNG
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = prng(20260401);
const pick = <T>(arr: T[]): T => {
  const v = arr[Math.floor(rnd() * arr.length)];
  if (v === undefined) throw new Error("pick from empty array");
  return v;
};
const randInt = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

const dayMs = 86400000;
const startMs = Date.parse(`${START_DAY}T00:00:00Z`);
const endMs = Date.parse(`${END_DAY}T00:00:00Z`);
const NUM_DAYS = Math.round((endMs - startMs) / dayMs) + 1;
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const iso = (ms: number): string => new Date(ms).toISOString();
const dayIndex = (day: string): number =>
  Math.round((Date.parse(`${day}T00:00:00Z`) - startMs) / dayMs);

function lorem(chars: number, topic: string): string {
  const base = `Working the ${topic} for the engagement: pull the supporting documents, check the amounts against the ledger, and note anything that does not reconcile. `;
  let out = "";
  while (out.length < chars) out += base;
  return out.slice(0, chars);
}

// ------------------------------------------------------------- session recipe

interface SessionSpec {
  id: string;
  client: string;
  entity: string;
  auditor: string;
  startMs: number;
  turnPlan: TurnPlan[];
  firstTurnNumber: number;
  missingTurns: number[];
  jobType: JobType;
  outcome: SessionOutcome | null; // "unclassified" allowed; null never used in enriched run
  outcomeEvidence: string | null;
  endedMidWork: boolean | null;
  frictionShare: number | null;
  dominantCause: FrictionCause | null;
  dominantSignature: string | null;
}

interface TurnPlan {
  gapS: number | null; // gap before this turn
  toolCalls: PlannedCall[];
  userChars: number;
  markers: { task?: boolean; skill?: boolean; extract?: boolean };
  platformLimit?: boolean;
  correction?: boolean;
  friction?: number;
  cause?: FrictionCause;
}

interface PlannedCall {
  family: string;
  tool: string;
  sig?: string; // pattern_id
  repeatOf?: number; // seq_index
}

function planCalls(n: number, family?: string, sig?: string, sigEvery = 0): PlannedCall[] {
  const calls: PlannedCall[] = [];
  for (let i = 0; i < n; i++) {
    const fam = family ?? pick(FAMILIES.filter((f) => f !== "subagent"));
    const call: PlannedCall = { family: fam, tool: pick(TOOLS[fam] ?? ["Bash"]) };
    if (sig && sigEvery > 0 && i % sigEvery === 0) call.sig = sig;
    calls.push(call);
  }
  return calls;
}

const sessions: SessionSpec[] = [];
let sessionSeq = 0;

function addSession(
  partial: Partial<SessionSpec> & { startMs: number; turnPlan: TurnPlan[] },
): SessionSpec {
  sessionSeq += 1;
  const client = partial.client ?? (rnd() < 0.7 ? "meridian" : pick(["harborlight", "ashford"]));
  const entities = CLIENTS[client] ?? ["unknown"];
  const outcomeRoll = rnd();
  const outcome: SessionOutcome =
    outcomeRoll < 0.55 ? "completed" : outcomeRoll < 0.75 ? "undetermined" : "abandoned";
  const spec: SessionSpec = {
    id: partial.id ?? `s-${String(sessionSeq).padStart(4, "0")}`,
    client,
    entity: partial.entity ?? pick(entities),
    auditor: partial.auditor ?? pick(AUDITORS),
    startMs: partial.startMs,
    turnPlan: partial.turnPlan,
    firstTurnNumber: partial.firstTurnNumber ?? 1,
    missingTurns: partial.missingTurns ?? [],
    jobType: partial.jobType ?? pick(JOB_TYPES.slice(0, 7)),
    outcome: partial.outcome !== undefined ? partial.outcome : outcome,
    outcomeEvidence:
      partial.outcomeEvidence !== undefined
        ? partial.outcomeEvidence
        : "Final turn delivers a summary of the completed checks; see closing turns.",
    endedMidWork: partial.endedMidWork ?? false,
    frictionShare: partial.frictionShare ?? Math.round(rnd() * 40) / 100,
    dominantCause: partial.dominantCause ?? "none",
    dominantSignature: partial.dominantSignature ?? null,
  };
  sessions.push(spec);
  return spec;
}

function bulkTurns(
  n: number,
  opts?: { sig?: string; sigFamily?: string; friction?: number },
): TurnPlan[] {
  const turns: TurnPlan[] = [];
  for (let i = 0; i < n; i++) {
    const calls = planCalls(randInt(0, 9));
    if (opts?.sig && i % 3 === 1) {
      // insert mid-turn so post_failure_shape gets a realistic mix
      const fam = opts.sigFamily ?? "browser";
      const at = calls.length > 0 ? randInt(0, calls.length) : 0;
      calls.splice(at, 0, { family: fam, tool: pick(TOOLS[fam] ?? ["Bash"]), sig: opts.sig });
      if (rnd() < 0.5) calls.push({ family: fam, tool: pick(TOOLS[fam] ?? ["Bash"]) });
    }
    const turn: TurnPlan = {
      gapS: i === 0 ? null : randInt(20, 2400),
      toolCalls: calls,
      userChars: randInt(40, 900),
      markers: rnd() < 0.12 ? { task: rnd() < 0.5, extract: rnd() < 0.4 } : {},
    };
    if (opts?.friction && i % 4 === 2) {
      turn.friction = opts.friction;
      turn.cause = "system_failure";
    }
    turns.push(turn);
  }
  return turns;
}

// --- scripted worst-case sessions -------------------------------------------

// 76-turn monster with a 131-call browser-grind turn and a 46KB extract message
{
  const turnPlan: TurnPlan[] = bulkTurns(73, { sig: "portal-auth-403", friction: 0.7 });
  const grind: PlannedCall[] = planCalls(131, "browser", "portal-auth-403", 17);
  for (let i = 40; i < 131; i++) {
    const c = grind[i];
    if (c) {
      c.tool = "mcp__claude-in-chrome__computer";
      if (i > 45 && i % 3 === 0) c.repeatOf = 40;
    }
  }
  turnPlan.push({
    gapS: 300,
    toolCalls: grind,
    userChars: 200,
    markers: {},
    friction: 0.9,
    cause: "capability_gap",
  });
  turnPlan.push({
    gapS: 4000,
    toolCalls: planCalls(4, "file"),
    userChars: 47104, // the 46KB collapsed message
    markers: { extract: true },
  });
  turnPlan.push({
    gapS: 600,
    toolCalls: planCalls(6, "shell"),
    userChars: 300,
    markers: {},
    correction: true,
  });
  addSession({
    id: "s-monster",
    client: "meridian",
    entity: "meridian-us",
    auditor: "a.chen",
    startMs: Date.parse("2026-03-18T09:12:00Z"),
    turnPlan,
    jobType: "extraction_supervision",
    outcome: "completed",
    outcomeEvidence: "Turn 76 posts the finished extraction summary; turns 74-75 verify totals.",
    frictionShare: 0.44,
    dominantCause: "capability_gap",
  });
}

// platform-limit banner session (marker turns 1-7, keeps running)
{
  const turnPlan = bulkTurns(20);
  for (let i = 0; i < 7; i++) {
    const t = turnPlan[i];
    if (t) t.platformLimit = true;
  }
  addSession({
    id: "s-limit",
    client: "harborlight",
    entity: "harborlight-core",
    auditor: "d.malik",
    startMs: Date.parse("2026-03-22T13:40:00Z"),
    turnPlan,
    jobType: "tie_out",
    outcome: "undetermined",
    outcomeEvidence:
      "Spend-limit marker present early but work continues to turn 20; end state unclear.",
    endedMidWork: null,
  });
}

// resumed fragment: turn numbering starts at 22
addSession({
  id: "s-resumed",
  client: "meridian",
  entity: "meridian-emea",
  auditor: "e.novak",
  startMs: Date.parse("2026-03-12T08:05:00Z"),
  turnPlan: bulkTurns(38),
  firstTurnNumber: 22,
  jobType: "doc_inventory",
  outcome: "undetermined",
  outcomeEvidence: "Leading turns lost by telemetry; cannot establish the task's start or end.",
});

// internal missing turns (2-3 absent)
addSession({
  id: "s-gapturns",
  client: "ashford",
  entity: "ashford-trust",
  auditor: "f.reyes",
  startMs: Date.parse("2026-03-15T15:30:00Z"),
  turnPlan: bulkTurns(9),
  missingTurns: [2, 3],
  jobType: "doc_location",
  outcome: "completed",
  outcomeEvidence: "Turn 11 confirms the located documents were attached.",
});

// enrichment-abstained session (outcome = unclassified in the enriched run)
addSession({
  id: "s-unclassified",
  client: "meridian",
  entity: "meridian-us",
  auditor: "g.sato",
  startMs: Date.parse("2026-03-20T11:00:00Z"),
  turnPlan: bulkTurns(6),
  jobType: "other",
  outcome: "unclassified",
  outcomeEvidence: null,
  endedMidWork: null,
  frictionShare: null,
  dominantCause: null,
});

// long-span session: 12 days wall span, tiny engaged time (scatter outlier)
{
  const turnPlan = bulkTurns(8);
  for (let i = 1; i < 8; i++) {
    const t = turnPlan[i];
    if (t) t.gapS = i % 3 === 0 ? 3600 * 24 * 3 : 900;
  }
  addSession({
    id: "s-longspan",
    client: "ashford",
    entity: "ashford-re",
    auditor: "b.osei",
    startMs: Date.parse("2026-03-06T10:00:00Z"),
    turnPlan,
    jobType: "drafting",
    outcome: "abandoned",
    outcomeEvidence:
      "Twelve-day span with three brief bouts; last turn leaves the draft unreviewed.",
    endedMidWork: true,
  });
}

// quick-restart pair (same auditor, <1h apart)
addSession({
  id: "s-restart-a",
  client: "meridian",
  entity: "meridian-us",
  auditor: "c.ivanov",
  startMs: Date.parse("2026-03-25T09:00:00Z"),
  turnPlan: bulkTurns(5),
  jobType: "doc_receipt_check",
  outcome: "completed",
});
addSession({
  id: "s-restart-b",
  client: "meridian",
  entity: "meridian-us",
  auditor: "c.ivanov",
  startMs: Date.parse("2026-03-25T10:10:00Z"),
  turnPlan: bulkTurns(7),
  jobType: "doc_receipt_check",
  outcome: "completed",
});

// demo traffic: tealstone client, two days only
for (let i = 0; i < 3; i++) {
  addSession({
    client: "tealstone",
    entity: "tealstone-demo",
    auditor: "a.chen",
    startMs: Date.parse("2026-03-10T12:00:00Z") + i * 3 * 3600000 + (i === 2 ? dayMs : 0),
    turnPlan: bulkTurns(randInt(3, 6)),
    jobType: "capability_probe",
    outcome: "completed",
  });
}

// incident window: portal-auth-403 spike Mar 29-31 across many sessions/auditors
for (let i = 0; i < 14; i++) {
  const day = pick([INCIDENT_START, "2026-03-30", INCIDENT_END]);
  addSession({
    auditor: AUDITORS[i % 7],
    startMs: Date.parse(`${day}T08:00:00Z`) + randInt(0, 9) * 3600000,
    turnPlan: bulkTurns(randInt(4, 12), { sig: "portal-auth-403", friction: 0.8 }),
    jobType: pick<JobType>(["doc_location", "tie_out", "doc_receipt_check", "doc_inventory"]),
    outcome: pick<SessionOutcome>(["abandoned", "undetermined", "completed"]),
    outcomeEvidence: "Repeated portal 403s dominate the session; see the failing turns.",
    frictionShare: 0.6 + Math.round(rnd() * 30) / 100,
    dominantCause: "system_failure",
    dominantSignature: "portal-auth-403",
  });
}

// bulk background sessions across the window
for (let i = 0; i < 38; i++) {
  const dayIdx = randInt(0, NUM_DAYS - 3);
  const sigRoll = rnd();
  const opts =
    sigRoll < 0.2
      ? { sig: "cli-command-not-found", sigFamily: "shell", friction: 0.6 }
      : sigRoll < 0.3
        ? { sig: "missing-file", sigFamily: "file" }
        : sigRoll < 0.38
          ? { sig: "tool-http-5xx", sigFamily: "docstore" }
          : sigRoll < 0.44
            ? { sig: "python-traceback", sigFamily: "shell" }
            : sigRoll < 0.5
              ? { sig: "askuserquestion-exit-1", sigFamily: "other" }
              : undefined;
  addSession({
    startMs: startMs + dayIdx * dayMs + randInt(7, 18) * 3600000,
    turnPlan: bulkTurns(randInt(2, 16), opts),
    ...(opts?.sig === "cli-command-not-found"
      ? {
          dominantCause: "system_failure" as FrictionCause,
          dominantSignature: "cli-command-not-found",
        }
      : {}),
  });
}

// a few subagent-failure events
addSession({
  id: "s-subagent",
  client: "meridian",
  entity: "meridian-us",
  auditor: "b.osei",
  startMs: Date.parse("2026-03-27T14:00:00Z"),
  turnPlan: (() => {
    const t = bulkTurns(6);
    const first = t[1];
    if (first)
      first.toolCalls.push(
        { family: "subagent", tool: "Agent", sig: "agent-generic-error" },
        { family: "subagent", tool: "Agent", sig: "agent-generic-error" },
      );
    return t;
  })(),
  jobType: "doc_inventory",
  outcome: "completed",
});

// -------------------------------------------------------------- materializing

const turnRows: TurnRow[] = [];
const eventRows: ToolEventRow[] = [];
const sessionRows: SessionRow[] = [];

for (const s of sessions) {
  const isDemo = s.client === "tealstone" || s.auditor === "demo";
  let ts = s.startMs;
  let boutCount = 1;
  let cappedGap = 0;
  let turnNumber = s.firstTurnNumber - 1;
  let firstTs = 0;
  let lastTs = 0;
  let interactionCost = 0;
  let lastTurn: TurnPlan | null = null;
  let lastTurnErrors = 0;

  s.turnPlan.forEach((tp, ti) => {
    turnNumber += 1;
    while (s.missingTurns.includes(turnNumber)) turnNumber += 1;
    if (tp.gapS !== null) {
      ts += tp.gapS * 1000;
      if (tp.gapS > GAP_CAP_S) boutCount += 1;
      else cappedGap += tp.gapS;
    }
    if (ti === 0) firstTs = ts;
    lastTs = ts;

    const day = dayOf(ts);
    const hasMarker = Boolean(tp.markers.task || tp.markers.skill || tp.markers.extract);
    const typedPrefix = hasMarker ? Math.min(tp.userChars, randInt(0, 400)) : tp.userChars;
    if (typedPrefix > 0) interactionCost += 1;

    // per-turn tool events
    let errorCount = 0;
    let maxRun = 0;
    let run = 0;
    let prevTool = "";
    let chainCount = 0;
    const failIdx: number[] = [];
    tp.toolCalls.forEach((c, seq) => {
      if (c.tool === prevTool) run += 1;
      else {
        run = 1;
        prevTool = c.tool;
      }
      if (run > maxRun) maxRun = run;
      if (c.repeatOf !== undefined) chainCount += 1;
      const sig = c.sig ? SIG_BY_ID.get(c.sig) : undefined;
      const isAgent = c.family === "subagent";
      if (sig && sig.counts_as_failure === "true" && !isAgent) {
        errorCount += 1;
        failIdx.push(seq);
      }
      const verdict = !sig
        ? "none"
        : sig.counts_as_failure === "true"
          ? "rule"
          : c.sig === "askuserquestion-exit-1"
            ? rnd() < 0.5
              ? "model_cleared"
              : "model_added"
            : "uncertain";
      eventRows.push({
        session_id: s.id,
        day,
        client: s.client,
        entity: s.entity,
        auditor: s.auditor,
        is_demo_traffic: isDemo,
        job_type: s.jobType,
        turn_number: turnNumber,
        ts: iso(ts),
        seq_index: seq,
        tool_name: c.tool,
        tool_family: c.family as ToolEventRow["tool_family"],
        is_agent_tool: isAgent,
        matched_signature_id: c.sig ?? null,
        matched_snippet: sig ? sig.snippet : null,
        rule_version: sig ? RULE_VERSION : null,
        failure_verdict: verdict,
        post_failure_shape: null, // filled below
        repeat_of_seq_index: c.repeatOf ?? null,
      });
    });
    // post_failure_shape for the failure events of this turn
    for (const fi of failIdx) {
      const ev = eventRows[eventRows.length - tp.toolCalls.length + fi];
      if (!ev) continue;
      const failedTool = tp.toolCalls[fi]?.tool;
      const later = tp.toolCalls.slice(fi + 1);
      ev.post_failure_shape =
        later.length === 0
          ? "turn_ends_on_failure"
          : later.some((c) => c.tool === failedTool && !c.sig)
            ? "same_tool_clean_later"
            : "other_calls_after";
    }
    lastTurnErrors = errorCount;
    lastTurn = tp;

    const shortGap = tp.gapS !== null && tp.gapS < 120;
    turnRows.push({
      session_id: s.id,
      day,
      client: s.client,
      entity: s.entity,
      auditor: s.auditor,
      is_demo_traffic: isDemo,
      job_type: s.jobType,
      turn_number: turnNumber,
      ts: iso(ts),
      gap_before_s: tp.gapS,
      has_task_notification: Boolean(tp.markers.task),
      has_skill_body: Boolean(tp.markers.skill),
      has_extract_paste: Boolean(tp.markers.extract),
      typed_prefix_chars: typedPrefix,
      user_chars: tp.userChars,
      assistant_chars: randInt(200, 6000),
      tool_count: tp.toolCalls.length,
      error_count: errorCount,
      max_same_tool_run: maxRun,
      identical_input_chain_count: chainCount,
      platform_limit_marker: Boolean(tp.platformLimit),
      short_typed_after_short_gap: Boolean(shortGap && typedPrefix > 0 && typedPrefix < 200),
      is_correction: tp.correction ?? false,
      turn_friction: tp.friction ?? (tp.cause ? 0.5 : Math.round(rnd() * 20) / 100),
      friction_cause: tp.cause ?? "none",
      linked_failure_signature_id:
        tp.cause === "system_failure" ? (s.dominantSignature ?? "portal-auth-403") : null,
      user_text:
        tp.userChars > 2000
          ? lorem(tp.userChars, "pasted portal extract")
          : lorem(tp.userChars, s.jobType ?? "task"),
      assistant_text: lorem(randInt(200, 3000), "response"),
    });
    ts += randInt(30, 400) * 1000;
  });

  const lt: TurnPlan | null = lastTurn;
  sessionRows.push({
    session_id: s.id,
    client: s.client,
    entity: s.entity,
    auditor: s.auditor,
    is_demo_traffic: isDemo,
    turn_count: s.turnPlan.length,
    first_ts: iso(firstTs),
    last_ts: iso(lastTs),
    wall_span_s: Math.max(0, (lastTs - firstTs) / 1000),
    capped_gap_span_s: cappedGap,
    bout_count: boutCount,
    final_turn_tool_count: lt ? (lt as TurnPlan).toolCalls.length : 0,
    final_turn_error_count: lastTurnErrors,
    resumed_fragment: s.firstTurnNumber > 1,
    missing_turns: encodeIntArray(s.missingTurns),
    interaction_cost: interactionCost,
    quick_restart_after_s: s.id === "s-restart-a" ? 4200 : null,
    job_type: s.jobType,
    job_type_secondary: s.jobType === "extraction_supervision" ? "doc_inventory" : null,
    outcome: s.outcome,
    outcome_evidence: s.outcomeEvidence,
    ended_mid_work: s.endedMidWork,
    friction_share: s.frictionShare,
    dominant_friction_cause: s.dominantCause,
    dominant_linked_signature: s.dominantSignature,
  });
}

// ------------------------------------------------------------- reference plane

function seriesFor(pred: (e: ToolEventRow) => boolean): number[] {
  const out = new Array(NUM_DAYS).fill(0);
  for (const e of eventRows) if (pred(e)) out[dayIndex(e.day)] += 1;
  return out;
}

const signatureRows: FailureSignatureRow[] = SIGS.map((sig) => {
  const evs = eventRows.filter((e) => e.matched_signature_id === sig.pattern_id);
  const sessionsOf = new Set(evs.map((e) => e.session_id));
  const auditorsOf = new Set(evs.map((e) => e.auditor));
  const clientsOf = new Set(evs.map((e) => e.client));
  const finalTurns = new Map(sessionRows.map((r) => [r.session_id, r]));
  let terminal = 0;
  for (const e of evs) {
    const sess = finalTurns.get(e.session_id);
    const lastTurnOfSession = turnRows
      .filter((t) => t.session_id === e.session_id)
      .reduce((m, t) => Math.max(m, t.turn_number), 0);
    if (sess && e.turn_number === lastTurnOfSession) terminal += 1;
  }
  const shape = (v: string) => evs.filter((e) => e.post_failure_shape === v).length;
  return {
    pattern_id: sig.pattern_id,
    display_name: sig.display_name,
    signature_class: sig.signature_class,
    counts_as_failure: sig.counts_as_failure,
    rule_version: RULE_VERSION,
    event_count: evs.length,
    session_count: sessionsOf.size,
    auditor_count: auditorsOf.size,
    client_count: clientsOf.size,
    first_seen: evs.length ? (evs.map((e) => e.ts).sort()[0] ?? null) : null,
    last_seen: evs.length
      ? (evs
          .map((e) => e.ts)
          .sort()
          .at(-1) ?? null)
      : null,
    series_start_day: START_DAY,
    daily_series: encodeIntArray(seriesFor((e) => e.matched_signature_id === sig.pattern_id)),
    terminal_rate: evs.length ? terminal / evs.length : null,
    shape_same_tool_clean_later: shape("same_tool_clean_later"),
    shape_other_calls_after: shape("other_calls_after"),
    shape_turn_ends_on_failure: shape("turn_ends_on_failure"),
    j5_false_positive_rate: sig.counts_as_failure === "true" ? Math.round(rnd() * 8) / 100 : null,
    j5_missed_rate: sig.counts_as_failure === "true" ? Math.round(rnd() * 12) / 100 : null,
  };
});

const incidentSessions = sessionRows.filter(
  (r) => r.first_ts >= `${INCIDENT_START}T00:00:00` && r.first_ts <= `${INCIDENT_END}T23:59:59`,
);
const incidentRows: IncidentRow[] = [
  {
    incident_id: "inc-2026-03-29-portal-auth",
    signature_ids: encodeStringArray(["portal-auth-403", "portal-token-missing"]),
    start_ts: `${INCIDENT_START}T00:00:00.000Z`,
    end_ts: `${INCIDENT_END}T23:59:59.000Z`,
    blast_sessions: incidentSessions.length,
    blast_auditors: new Set(incidentSessions.map((r) => r.auditor)).size,
    blast_clients: new Set(incidentSessions.map((r) => r.client)).size,
    linked_friction_cost: Math.round(
      incidentSessions.reduce((acc, r) => acc + (r.friction_share ?? 0) * r.turn_count, 0),
    ),
  },
];

// capability gaps: derived from structural shapes in the generated data
interface GapSpec {
  gap_id: string;
  display_name: string;
  description: string;
  evidence_pattern: string;
  memberIds: string[];
}
const browserHeavy = new Set(
  eventRows.filter((e) => e.tool_family === "browser").map((e) => e.session_id),
);
const extractSessions = new Set(
  turnRows.filter((t) => t.has_extract_paste).map((t) => t.session_id),
);
const shellPdfSessions = new Set(
  sessionRows
    .filter((r) => !r.is_demo_traffic && r.session_id.charCodeAt(2) % 5 === 0)
    .map((r) => r.session_id),
);
const gapSpecs: GapSpec[] = [
  {
    gap_id: "gap-browser-grind",
    display_name: "Portal work falls back to raw browser driving",
    description: "CLI/API paths fail and auditors grind through the portal UI call by call.",
    evidence_pattern: "browser-call concentration after CLI failure in the same session",
    memberIds: [...browserHeavy],
  },
  {
    gap_id: "gap-clipboard-extracts",
    display_name: "Extracts are clipboard-ferried into the chat",
    description: "Large pasted extracts stand in for a missing ingestion path.",
    evidence_pattern: "extract-paste marker turns with >2KB pasted content",
    memberIds: [...extractSessions],
  },
  {
    gap_id: "gap-shell-pdf",
    display_name: "Shell pdftotext pipeline over the sanctioned docstore",
    description: "PDF text extraction runs via shell instead of the docstore reader.",
    evidence_pattern: "shell pdftotext invocations where docstore read was available",
    memberIds: [...shellPdfSessions],
  },
];
const sessionById = new Map(sessionRows.map((r) => [r.session_id, r]));
const gapRows: CapabilityGapRow[] = gapSpecs.map((g) => {
  const members = g.memberIds
    .map((id) => sessionById.get(id))
    .filter((r): r is SessionRow => Boolean(r));
  const series = new Array(NUM_DAYS).fill(0);
  for (const m of members) series[dayIndex(m.first_ts.slice(0, 10))] += 1;
  return {
    gap_id: g.gap_id,
    display_name: g.display_name,
    description: g.description,
    evidence_pattern: g.evidence_pattern,
    session_count: members.length,
    auditor_count: new Set(members.map((m) => m.auditor)).size,
    interaction_cost_estimate: members.reduce((a, m) => a + m.interaction_cost, 0),
    series_start_day: START_DAY,
    daily_series: encodeIntArray(series),
  };
});
const gapSessionRows: GapSessionRow[] = gapSpecs.flatMap((g) =>
  g.memberIds.map((id, i) => ({ gap_id: g.gap_id, session_id: id, is_exemplar: i < 3 })),
);

// auditor timeline
const timelineMap = new Map<string, AuditorTimelineRow>();
for (const t of turnRows) {
  const key = `${t.auditor}|${t.day}`;
  let row = timelineMap.get(key);
  if (!row) {
    row = {
      auditor: t.auditor,
      day: t.day,
      turns: 0,
      sessions_touched: 0,
      clients_touched: 0,
      capped_gap_span_s: 0,
      bout_count: 1,
    };
    timelineMap.set(key, row);
  }
  row.turns += 1;
  if (t.gap_before_s !== null) {
    if (t.gap_before_s > GAP_CAP_S) row.bout_count += 1;
    else row.capped_gap_span_s += t.gap_before_s;
  }
}
for (const row of timelineMap.values()) {
  const dayTurns = turnRows.filter((t) => t.auditor === row.auditor && t.day === row.day);
  row.sessions_touched = new Set(dayTurns.map((t) => t.session_id)).size;
  row.clients_touched = new Set(dayTurns.map((t) => t.client)).size;
}
const timelineRows = [...timelineMap.values()].sort((a, b) =>
  `${a.auditor}${a.day}`.localeCompare(`${b.auditor}${b.day}`),
);

// dims
const dimRows: DimRow[] = [
  ...Object.keys(CLIENTS).map((c) => ({ kind: "client" as const, value: c, parent: null })),
  ...Object.entries(CLIENTS).flatMap(([c, es]) =>
    es.map((e) => ({ kind: "entity" as const, value: e, parent: c })),
  ),
  ...AUDITORS.map((a) => ({ kind: "auditor" as const, value: a, parent: null })),
  ...FAMILIES.map((f) => ({ kind: "tool_family" as const, value: f, parent: null })),
  ...JOB_TYPES.map((j) => ({ kind: "job_type" as const, value: j, parent: null })),
  ...[...new Set(SIGS.map((s) => s.signature_class))].map((sc) => ({
    kind: "signature_class" as const,
    value: sc,
    parent: null,
  })),
];

// findings
const portalSig = signatureRows.find((r) => r.pattern_id === "portal-auth-403");
const cliSig = signatureRows.find((r) => r.pattern_id === "cli-command-not-found");
const topGap = [...gapRows].sort(
  (a, b) => b.interaction_cost_estimate - a.interaction_cost_estimate,
)[0];
const determined = sessionRows.filter(
  (r) => r.outcome === "completed" || r.outcome === "abandoned",
);
const findingRows: FindingRow[] = [
  {
    finding_id: "portal-auth-wall",
    rank: 1,
    audience: "ops",
    title: `Portal auth failures are systemic, spiking Mar 29-31 across ${portalSig?.session_count ?? 0} sessions and ${portalSig?.auditor_count ?? 0} auditors`,
    metric_value: portalSig?.event_count ?? 0,
    metric_label: "events",
    sparkline: portalSig?.daily_series ?? "[]",
    series_start_day: START_DAY,
    target_params: encodeTargetParams({
      side: "ops",
      signature: "portal-auth-403",
      from: INCIDENT_START,
      to: END_DAY,
    }),
    provenance: "heuristic",
    requires_enrichment: false,
  },
  {
    finding_id: "missing-clis",
    rank: 2,
    audience: "ops",
    title: "Three unprovisioned CLIs account for every command-not-found failure",
    metric_value: cliSig?.event_count ?? 0,
    metric_label: "events",
    sparkline: cliSig?.daily_series ?? "[]",
    series_start_day: START_DAY,
    target_params: encodeTargetParams({ side: "ops", signature: "cli-command-not-found" }),
    provenance: "heuristic",
    requires_enrichment: false,
  },
  {
    finding_id: "top-capability-gap",
    rank: 3,
    audience: "product",
    title: `"${topGap?.display_name ?? "top gap"}" is the costliest workaround (${topGap?.interaction_cost_estimate ?? 0} human turns)`,
    metric_value: topGap?.interaction_cost_estimate ?? 0,
    metric_label: "human turns",
    sparkline: topGap?.daily_series ?? "[]",
    series_start_day: START_DAY,
    target_params: encodeTargetParams({ side: "product", gap: topGap?.gap_id ?? "" }),
    provenance: "model",
    requires_enrichment: true,
  },
  {
    finding_id: "job-concentration",
    rank: 4,
    audience: "product",
    title: "Top 3 job types account for the large majority of sessions",
    metric_value: determined.length,
    metric_label: "determined sessions",
    sparkline: "[]",
    series_start_day: null,
    target_params: encodeTargetParams({ side: "product", page: "usage" }),
    provenance: "model",
    requires_enrichment: true,
  },
  {
    finding_id: "friction-system-failure",
    rank: 5,
    audience: "product",
    title: "System failures dominate high-friction sessions in the incident window",
    metric_value: incidentSessions.length,
    metric_label: "sessions touched",
    sparkline: "[]",
    series_start_day: null,
    target_params: encodeTargetParams({
      side: "product",
      page: "outcomes",
      from: INCIDENT_START,
      to: INCIDENT_END,
    }),
    provenance: "model",
    requires_enrichment: true,
  },
];

// -------------------------------------------------------------- validation

function validateAll<T>(name: string, schema: { parse: (v: unknown) => T }, rows: unknown[]): void {
  rows.forEach((r, i) => {
    try {
      schema.parse(r);
    } catch (err) {
      console.error(`row ${i} of ${name}:`, JSON.stringify(r).slice(0, 400));
      throw err;
    }
  });
  console.log(`validated ${name}: ${rows.length} rows`);
}
validateAll("facts/turns", TurnRowSchema, turnRows);
validateAll("facts/tool_events", ToolEventRowSchema, eventRows);
validateAll("ref/sessions", SessionRowSchema, sessionRows);
validateAll("ref/failure_signatures", FailureSignatureRowSchema, signatureRows);
validateAll("ref/incidents", IncidentRowSchema, incidentRows);
validateAll("ref/capability_gaps", CapabilityGapRowSchema, gapRows);
validateAll("ref/gap_sessions", GapSessionRowSchema, gapSessionRows);
validateAll("ref/findings", FindingRowSchema, findingRows);
validateAll("ref/auditor_timeline", AuditorTimelineRowSchema, timelineRows);
validateAll("ref/dims", DimRowSchema, dimRows);

// -------------------------------------------------------------- degraded copy

function nullModelFields<T extends Record<string, unknown>>(rows: T[], fields: string[]): T[] {
  return rows.map((r) => {
    const copy: Record<string, unknown> = { ...r };
    for (const f of fields) copy[f] = null;
    return copy as T;
  });
}
const degTurns = nullModelFields(turnRows, [
  "is_correction",
  "turn_friction",
  "friction_cause",
  "job_type",
]);
const degEvents = eventRows.map((e) => ({
  ...e,
  job_type: null,
  failure_verdict:
    e.failure_verdict === "model_added" || e.failure_verdict === "model_cleared"
      ? "uncertain"
      : e.failure_verdict,
}));
const degSessions = nullModelFields(sessionRows, [
  "job_type",
  "job_type_secondary",
  "outcome",
  "outcome_evidence",
  "ended_mid_work",
  "friction_share",
  "dominant_friction_cause",
]);
const degSignatures = nullModelFields(signatureRows, ["j5_false_positive_rate", "j5_missed_rate"]);
const degIncidents = nullModelFields(incidentRows, ["linked_friction_cost"]);
const degGaps = nullModelFields(gapRows, ["display_name", "description"]);
const degFindings = findingRows.filter((f) => !f.requires_enrichment);
validateAll("degraded turns", TurnRowSchema, degTurns);
validateAll("degraded sessions", SessionRowSchema, degSessions);
validateAll("degraded gaps", CapabilityGapRowSchema, degGaps);

// ---------------------------------------------------------------- write layer

// DuckDB column type declarations per table (read_json needs explicit types so
// timestamps stay VARCHAR — the contract publishes ISO strings, not TIMESTAMP).
const T = {
  v: "VARCHAR",
  b: "BOOLEAN",
  i: "BIGINT",
  d: "DOUBLE",
};
const factDimCols = {
  session_id: T.v,
  day: T.v,
  client: T.v,
  entity: T.v,
  auditor: T.v,
  is_demo_traffic: T.b,
  job_type: T.v,
};
const COLS: Record<string, Record<string, string>> = {
  turns: {
    ...factDimCols,
    turn_number: T.i,
    ts: T.v,
    gap_before_s: T.d,
    has_task_notification: T.b,
    has_skill_body: T.b,
    has_extract_paste: T.b,
    typed_prefix_chars: T.i,
    user_chars: T.i,
    assistant_chars: T.i,
    tool_count: T.i,
    error_count: T.i,
    max_same_tool_run: T.i,
    identical_input_chain_count: T.i,
    platform_limit_marker: T.b,
    short_typed_after_short_gap: T.b,
    is_correction: T.b,
    turn_friction: T.d,
    friction_cause: T.v,
    linked_failure_signature_id: T.v,
    user_text: T.v,
    assistant_text: T.v,
  },
  tool_events: {
    ...factDimCols,
    turn_number: T.i,
    ts: T.v,
    seq_index: T.i,
    tool_name: T.v,
    tool_family: T.v,
    is_agent_tool: T.b,
    matched_signature_id: T.v,
    matched_snippet: T.v,
    rule_version: T.v,
    failure_verdict: T.v,
    post_failure_shape: T.v,
    repeat_of_seq_index: T.i,
  },
  sessions: {
    session_id: T.v,
    client: T.v,
    entity: T.v,
    auditor: T.v,
    is_demo_traffic: T.b,
    turn_count: T.i,
    first_ts: T.v,
    last_ts: T.v,
    wall_span_s: T.d,
    capped_gap_span_s: T.d,
    bout_count: T.i,
    final_turn_tool_count: T.i,
    final_turn_error_count: T.i,
    resumed_fragment: T.b,
    missing_turns: T.v,
    interaction_cost: T.i,
    quick_restart_after_s: T.d,
    job_type: T.v,
    job_type_secondary: T.v,
    outcome: T.v,
    outcome_evidence: T.v,
    ended_mid_work: T.b,
    friction_share: T.d,
    dominant_friction_cause: T.v,
    dominant_linked_signature: T.v,
  },
  failure_signatures: {
    pattern_id: T.v,
    display_name: T.v,
    signature_class: T.v,
    counts_as_failure: T.v,
    rule_version: T.v,
    event_count: T.i,
    session_count: T.i,
    auditor_count: T.i,
    client_count: T.i,
    first_seen: T.v,
    last_seen: T.v,
    series_start_day: T.v,
    daily_series: T.v,
    terminal_rate: T.d,
    shape_same_tool_clean_later: T.i,
    shape_other_calls_after: T.i,
    shape_turn_ends_on_failure: T.i,
    j5_false_positive_rate: T.d,
    j5_missed_rate: T.d,
  },
  incidents: {
    incident_id: T.v,
    signature_ids: T.v,
    start_ts: T.v,
    end_ts: T.v,
    blast_sessions: T.i,
    blast_auditors: T.i,
    blast_clients: T.i,
    linked_friction_cost: T.d,
  },
  capability_gaps: {
    gap_id: T.v,
    display_name: T.v,
    description: T.v,
    evidence_pattern: T.v,
    session_count: T.i,
    auditor_count: T.i,
    interaction_cost_estimate: T.i,
    series_start_day: T.v,
    daily_series: T.v,
  },
  gap_sessions: { gap_id: T.v, session_id: T.v, is_exemplar: T.b },
  findings: {
    finding_id: T.v,
    rank: T.i,
    audience: T.v,
    title: T.v,
    metric_value: T.d,
    metric_label: T.v,
    sparkline: T.v,
    series_start_day: T.v,
    target_params: T.v,
    provenance: T.v,
    requires_enrichment: T.b,
  },
  auditor_timeline: {
    auditor: T.v,
    day: T.v,
    turns: T.i,
    sessions_touched: T.i,
    clients_touched: T.i,
    capped_gap_span_s: T.d,
    bout_count: T.i,
  },
  dims: { kind: T.v, value: T.v, parent: T.v },
};

const instance = await DuckDBInstance.create(":memory:");
const con = await instance.connect();
const scratch = join(import.meta.dir, ".scratch");
mkdirSync(scratch, { recursive: true });

const posix = (p: string): string => p.replaceAll("\\", "/");

async function writeParquet(
  table: string,
  rows: Record<string, unknown>[],
  outPath: string,
  where?: string,
): Promise<number> {
  const colSpec = Object.entries(COLS[table] ?? {})
    .map(([k, t]) => `'${k}': '${t}'`)
    .join(", ");
  const jsonl = join(scratch, `${table}.jsonl`);
  await Bun.write(jsonl, rows.map((r) => JSON.stringify(r)).join("\n"));
  await con.run(`CREATE OR REPLACE TABLE tmp_t AS
    SELECT * FROM read_json('${posix(jsonl)}', format='newline_delimited', columns={${colSpec}})`);
  const filter = where ? ` WHERE ${where}` : "";
  await con.run(`COPY (SELECT * FROM tmp_t${filter}) TO '${posix(outPath)}' (FORMAT parquet)`);
  const reader = await con.runAndReadAll(`SELECT count(*)::INT AS n FROM tmp_t${filter}`);
  const first = reader.getRowObjects()[0];
  return Number(first?.n ?? 0);
}

interface RunData {
  runId: string;
  turns: TurnRow[];
  events: ToolEventRow[];
  refs: Record<string, Record<string, unknown>[]>;
  enrichment: ServeManifest["enrichment"];
}

async function writeRun(run: RunData): Promise<void> {
  const root = join(OUT_ROOT, run.runId);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "facts", "turns"), { recursive: true });
  mkdirSync(join(root, "facts", "tool_events"), { recursive: true });
  mkdirSync(join(root, "ref"), { recursive: true });

  const partitions: ServeManifest["partitions"] = [];
  for (const [table, rows] of [
    ["turns", run.turns],
    ["tool_events", run.events],
  ] as const) {
    const days = [...new Set(rows.map((r) => r.day))].sort();
    for (const day of days) {
      const rel = `facts/${table}/day=${day}.parquet`;
      const n = await writeParquet(
        table,
        rows as Record<string, unknown>[],
        join(root, rel),
        `day = '${day}'`,
      );
      partitions.push({ table, day, path: rel, rows: n });
    }
  }
  const ref: ServeManifest["ref"] = [];
  for (const [table, rows] of Object.entries(run.refs)) {
    const rel = `ref/${table}.parquet`;
    const n = await writeParquet(table, rows, join(root, rel));
    ref.push({ table: table as ServeManifest["ref"][number]["table"], path: rel, rows: n });
  }
  const manifest: ServeManifest = {
    run_id: run.runId,
    published_at: "2026-04-03T00:00:00.000Z",
    date_coverage: { start_day: START_DAY, end_day: END_DAY },
    partitions,
    ref,
    enrichment: run.enrichment,
    rule_versions: { signatures: RULE_VERSION, thresholds: "thr-v0", findings: "fnd-v0" },
    stated_params: {
      gap_cap_s: GAP_CAP_S,
      quick_restart_window_s: 3600,
      matched_snippet_radius_chars: 300,
      incident_excursion_multiplier: 4,
      small_n_call_threshold: 200,
      grind_run_threshold: 10,
    },
  };
  ServeManifestSchema.parse(manifest);
  await Bun.write(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${run.runId}: ${partitions.length} partitions, ${ref.length} ref files`);
}

const cov = (judged: number, abstained = 0, error = 0) => ({ judged, abstained, error });
await writeRun({
  runId: RUN_ID,
  turns: turnRows,
  events: eventRows,
  refs: {
    sessions: sessionRows,
    failure_signatures: signatureRows,
    incidents: incidentRows,
    capability_gaps: gapRows,
    gap_sessions: gapSessionRows,
    findings: findingRows,
    auditor_timeline: timelineRows,
    dims: dimRows,
  },
  enrichment: {
    J1: cov(41, 3, 1),
    J2: cov(88, 4, 0),
    J3: cov(sessionRows.length - 1, 1, 0),
    J4: cov(3, 0, 0),
    J5: cov(250, 5, 2),
  },
});
await writeRun({
  runId: RUN_ID_DEGRADED,
  turns: degTurns,
  events: degEvents as ToolEventRow[],
  refs: {
    sessions: degSessions,
    failure_signatures: degSignatures,
    incidents: degIncidents,
    capability_gaps: degGaps,
    gap_sessions: gapSessionRows,
    findings: degFindings,
    auditor_timeline: timelineRows,
    dims: dimRows,
  },
  enrichment: {},
});

await Bun.write(
  join(OUT_ROOT, "latest.json"),
  `${JSON.stringify({ run_id: RUN_ID, published_at: "2026-04-03T00:00:00.000Z" }, null, 2)}\n`,
);
rmSync(scratch, { recursive: true, force: true });
con.closeSync();
instance.closeSync();
console.log("fixture pack complete");
