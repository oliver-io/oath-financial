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
// Field-level truncation (typed prefix to 200 chars, assistant tails to 500)
// happens in the SELECTOR SQL — the builders take rows as given and enforce
// only structural elision + the total budget, so they stay pure and testable
// against raw rows.

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
  /** chars-per-token estimate used for the budget check. */
  charsPerToken: 4,
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

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function overBudget(packet: Record<string, unknown>): boolean {
  return JSON.stringify(packet).length > TRUNCATION.contextBudgetTokens * TRUNCATION.charsPerToken;
}

/** J1 — gray-zone failure adjudication. output_text is load-bearing: the
 * adjudication reads the tool output itself (llm.md escape-hatch table). */
export const buildJ1Packet: PacketBuilder = (row) => {
  const output = str(row.output_text);
  if (output === null) {
    return {
      kind: "skip",
      reason: "missing_source_field",
      detail: "output_text missing — J1 adjudicates the tool output itself",
    };
  }
  return {
    kind: "packet",
    packet: {
      observation_id: str(row.observation_id),
      tool_name: str(row.tool_name),
      matched_signature_id: str(row.matched_signature_id),
      output_snippet:
        str(row.matched_snippet) ?? output.slice(0, TRUNCATION.toolOutputSnippetChars),
      seq_index: row.seq_index ?? null,
      following_tools: row.following_tools ?? [],
      assistant_tail: (str(row.assistant_tail) ?? "").slice(-TRUNCATION.assistantTailChars),
    },
    missing: [],
  };
};

/** J2 — turn classification. No load-bearing skip: every turn is classified
 * (the coverage denominator is the turn count); absent text rides along as an
 * explicit missing note. */
export const buildJ2Packet: PacketBuilder = (row) => {
  const missing: string[] = [];
  if (str(row.user_text) === null) missing.push("user_text");
  if (str(row.assistant_head) === null) missing.push("assistant_text");
  return {
    kind: "packet",
    packet: {
      trace_id: str(row.trace_id),
      session_id: str(row.session_id),
      turn_number: row.turn_number ?? null,
      // Session-position facts: the model's view has no future — these say
      // explicitly when nothing precedes / nothing follows this turn in the
      // data (a null prev_assistant_tail on a first turn means "none exists",
      // not "text missing"; a final turn's aftermath is unknowable, not absent).
      position: {
        is_first_turn: row.is_first_turn ?? null,
        is_final_turn: row.is_final_turn ?? null,
        session_turn_count: row.session_turn_count ?? null,
        session_resumed_fragment: row.session_resumed_fragment ?? false,
      },
      gap_before_s: row.gap_before_s ?? null,
      markers: {
        has_task_notification: row.has_task_notification ?? false,
        has_skill_body: row.has_skill_body ?? false,
        has_extract_paste: row.has_extract_paste ?? false,
        platform_limit_marker: row.platform_limit_marker ?? false,
      },
      typed_prefix_chars: row.typed_prefix_chars ?? null,
      is_correction_candidate: row.short_typed_after_short_gap ?? false,
      tool_families: row.tool_families ?? [],
      matched_signature_patterns: row.matched_patterns ?? [],
      user_text: str(row.user_text) ?? "",
      assistant_head: str(row.assistant_head) ?? "",
      assistant_tail: str(row.assistant_tail) ?? "",
      prev_assistant_tail: str(row.prev_assistant_tail),
      missing,
    },
    missing,
  };
};

interface TurnDigest {
  turn_number?: unknown;
  friction?: unknown;
  [k: string]: unknown;
}

/** J3 — session classification. Structural elision for pathological sessions:
 * keep first elisionKeepHead + last elisionKeepTail digests + every turn with a
 * friction/failure mark, note the elision count; still over budget → an
 * explicit packet_overflow skip, never truncation-by-silence. */
export const buildJ3Packet: PacketBuilder = (row) => {
  const rawTurns = Array.isArray(row.turns) ? (row.turns as TurnDigest[]) : [];
  // Mark session boundaries on the digests BEFORE elision (elision keeps the
  // head and tail, so the marked digests always survive): the model must know
  // which digest is the final exchange — nothing follows it in the data — and
  // which is the first OBSERVED turn (the true session start unless
  // resumed_fragment says the head was lost by telemetry).
  const turns = rawTurns.map((t, i) => ({
    ...t,
    ...(i === 0 ? { is_first_observed_turn: true } : {}),
    ...(i === rawTurns.length - 1 ? { is_final_turn: true } : {}),
  }));
  const { elisionKeepHead: head, elisionKeepTail: tail } = TRUNCATION;
  let kept = turns;
  let elided = 0;
  const base = {
    session_id: str(row.session_id),
    resumed_fragment: row.resumed_fragment ?? false,
    missing_turns: row.missing_turns ?? null,
    client: str(row.client),
    entity: str(row.entity),
    auditor: str(row.auditor),
    turn_count: row.turn_count ?? turns.length,
    final_turn_tool_count: row.final_turn_tool_count ?? null,
    final_turn_error_count: row.final_turn_error_count ?? null,
    final_assistant_tail: str(row.final_assistant_tail) ?? "",
  };
  const assemble = (): Record<string, unknown> => ({
    ...base,
    turns: kept,
    elided_turn_count: elided,
  });
  if (turns.length > head + tail && overBudget(assemble())) {
    const marked = new Set<TurnDigest>();
    for (const [i, t] of turns.entries()) {
      if (i < head || i >= turns.length - tail) marked.add(t);
      else if (t.friction !== null && t.friction !== undefined) marked.add(t);
    }
    kept = turns.filter((t) => marked.has(t));
    elided = turns.length - kept.length;
  }
  const packet = assemble();
  if (overBudget(packet)) {
    return {
      kind: "skip",
      reason: "packet_overflow",
      detail: `session digest exceeds the context budget after elision (${kept.length} digests kept, ${elided} elided)`,
    };
  }
  return { kind: "packet", packet, missing: [] };
};

/** J4 — capability-gap naming. The candidate session ids are load-bearing:
 * they are the validation set for the exemplar-⊆-input check. */
export const buildJ4Packet: PacketBuilder = (row) => {
  const candidates = Array.isArray(row.candidate_session_ids) ? row.candidate_session_ids : null;
  if (candidates === null || candidates.length === 0) {
    return {
      kind: "skip",
      reason: "missing_source_field",
      detail: "candidate_session_ids missing — nothing to name",
    };
  }
  return {
    kind: "packet",
    packet: {
      gap_id: str(row.gap_id),
      evidence_pattern: str(row.evidence_pattern),
      candidate_session_ids: candidates,
      members: row.members ?? [],
    },
    missing: [],
  };
};

/** J5 — heuristic audit. The snippet under audit is load-bearing. */
export const buildJ5Packet: PacketBuilder = (row) => {
  const snippet = str(row.matched_snippet) ?? str(row.output_text);
  if (snippet === null) {
    return {
      kind: "skip",
      reason: "missing_source_field",
      detail: "output snippet missing — nothing to audit",
    };
  }
  return {
    kind: "packet",
    packet: {
      observation_id: str(row.observation_id),
      bucket: str(row.bucket),
      tool_name: str(row.tool_name),
      matched_signature_id: str(row.matched_signature_id),
      snippet: snippet.slice(0, 2 * TRUNCATION.toolOutputSnippetChars),
    },
    missing: [],
  };
};
