# LLM Enrichment Architecture — the enrichment stage (stage 3)

How the LLM pipeline iterates over records, what structured outputs it produces, what
context each call is given, and what happens when that context is missing. Companion to
`docs/architecture/overview.md` (stage layout) and `docs/architecture/derivations.md` (field definitions).

## Principles

1. **The model classifies; it never counts.** Every number in the app is computed
   deterministically (stages 2/4). The model only assigns labels, judgments, and
   evidence pointers, which stage 4 then aggregates.
2. **The model never re-derives structure.** Every call receives the stage-2 facts
   (signature matches, gaps, marker flags, counts) *as input*. It reasons on top of
   facts, not instead of them.
3. **Abstention is a first-class output.** Every schema includes an `insufficient`
   verdict with a machine-readable reason. An abstention is written to the table like any
   other row and surfaces in the UI as its own category — the pipeline never guesses to
   fill a column, and never blocks on a record it can't judge.
4. **Quarantine + cache.** Outputs land in `enrich.*` side-tables keyed by
   (record id, job, prompt_version). Cache key is
   `hash(context_packet) + prompt_version + model_id`; re-runs reuse everything whose
   evidence and prompt didn't change. Full re-classification is an explicit flag.
5. **Everything is auditable.** Each row stores the model id, prompt version, packet
   hash, and the evidence pointers (turn ids / observation ids) the judgment cites, so
   any UI value traces to exactly what the model saw.

## Jobs

Enrichment is a set of independent **jobs**. Each job = (record selector, context-packet
builder, prompt version, output schema, writer). Jobs run in dependency order but are
individually optional and resumable; a job failing on some records degrades those records
to abstention, not the run.

| # | Job | Iterates over | Depends on |
|---|---|---|---|
| J1 | Gray-zone failure adjudication | flagged `tool_event`s | stage 2 |
| J2 | Turn classification (friction, correction) | turns (correction: candidates only) | stage 2 |
| J3 | Session classification (job type, outcome, ended-mid-work) | sessions | J2 |
| J4 | Capability-gap naming & grouping | pattern clusters (few records) | J3 |
| J5 | Heuristic audit (error-bar estimation) | random samples of tool_events | stage 2 |

### Iteration model

- **Unit of iteration is the job's record grain**, batched into API calls that stay under
  a fixed context budget (~20k tokens input per call). Turn-level jobs batch many turns
  of the *same session* per call (context coherence is free); session-level jobs are one
  session per call.
- **Batched-response contract**: an N-record call returns a JSON array of N outputs in
  record order; a single object is accepted as a broadcast to every record in the call
  (this is also the semantics scripted test responses carry — one outcome per call).
- Order within a run: J1 → J2 → J3 (J3 consumes J2's turn labels); J4 after J3; J5 any
  time. Records within a job are independent → concurrency N with retry.
- **Validation loop**: structured output is schema-validated; on mismatch, one retry with
  the validation error appended; on second mismatch the record is written as
  `enrich_error` (treated downstream exactly like an abstention, with reason
  `schema_failure`).
- Idempotent resume: a run touches only records with no cached row for the current
  (packet hash, prompt version).

## Context packets and schemas

All packets share truncation rules (deterministic, versioned with the prompt): user text
→ `typed_prefix` in full + first 500 chars of any pasted block, tagged; assistant text →
first 1,000 chars + last 500 (endings carry outcome signal); tool outputs → only the
±300 chars around a signature match, or first 300 chars for J1 gray-zone reads. Packets
embed *facts as structured JSON*, not prose descriptions of facts.

### J1 — gray-zone failure adjudication

Selector: tool_events where the rule table is explicitly unsure — signature matched with
`counts_as_failure = uncertain`, or curated per-instance exceptions (e.g. `exit 1` on
interactive tools). NOT every match (anchored matches with `counts_as_failure = true`
are final), NOT unmatched calls (that's J5's sampling problem).

Packet: the call's tool name, matched signature + surrounding output snippet, its
position in the turn's tool sequence, the two following tool calls (names + match
status), and the turn's assistant-text tail.

```json
{
  "verdict": "failure | non_failure | insufficient",
  "reason": "user_declined | recovered_immediately | benign_message | genuine_failure | other | null",
  "insufficient_reason": null,
  "confidence": "high | low",
  "evidence": "one sentence citing the packet"
}
```

### J2 — turn classification

Selector: all turns for `turn_friction`/`friction_cause`; only
`short_typed_after_short_gap` candidates for `is_correction`.

Packet (per turn, batched per session): turn facts (gap_before, marker flags,
typed_prefix, tool families + signature matches + post-failure shapes, platform-limit
marker), truncated user/assistant text, plus the *previous* turn's assistant tail (for
correction judgment).

```json
{
  "turn_friction": 0.0,
  "friction_cause": "system_failure | capability_gap | agent_behavior | user_request | none",
  "linked_signature_pattern": "portal-auth-403 | null",
  "is_correction": true,
  "verdict": "ok | insufficient",
  "insufficient_reason": null,
  "evidence": "one sentence"
}
```

`linked_signature_pattern` must name a signature that actually matched in this turn
(validated against stage 2 post-hoc; a dangling reference downgrades `friction_cause` to
`none` + flag) — the model cannot invent failures.

### J3 — session classification

Packet: session digest — client/entity/auditor, integrity flags (`resumed_fragment`,
`missing_turns`), per-turn one-liners (turn #, gap, typed prefix trimmed to 200 chars,
tool-family sequence with match marks, J2 friction labels), final-turn facts, and the
full assistant tail of the last turn.

```json
{
  "job_type": "doc_receipt_check | doc_location | doc_inventory | tie_out | portal_auth | extraction_supervision | drafting | capability_probe | other",
  "job_type_secondary": "… | null",
  "outcome": "completed | abandoned | undetermined",
  "outcome_evidence": "one sentence + pointer turn numbers",
  "ended_mid_work": true,
  "verdict": "ok | insufficient",
  "insufficient_reason": null
}
```

Note `undetermined` is a *judgment* ("I read it and can't tell — no marker distinguishes
kill from abandonment"), distinct from `insufficient` ("I couldn't read it").

### J4 — capability-gap naming

Selector: stage-2 pattern clusters (browser-grind sessions, extract-paste turns,
shell-PDF usage, orchestration scaffolding) → one call per cluster with exemplar session
digests. Output: display name, one-line description, exemplar session ids (must be ⊆
the input's ids — validated). Counts come from stage 2; the model only names and groups.
Gap *identity* (`gap_id`, the stable public key) is curated in the rule-file cluster
definitions upstream — J4 produces display text only, never identity.

### J5 — heuristic audit

Two fixed random samples (seeded, so re-runs are comparable): N=150 unmatched tool
outputs ("does this text indicate a failure the rule table missed?") and M=100 matched
ones ("is this match a false positive?"). Output per record: `missed_failure | correct |
false_positive | insufficient`. Stage 4 turns the sample rates into the error-bar
annotations the UI shows next to every failure count. The audit never modifies verdicts —
it measures the instrument.

## The escape hatch — missing/insufficient context

Cases and handling, in order of detection:

| Case | Detected | Handling |
|---|---|---|
| Record lacks the fields the packet needs (e.g. the 42 observations with no `output`, generations without usage) | packet builder | Packet is built with an explicit `"missing": ["output"]` note; if the missing field is *load-bearing* for the job (defined per job), skip the call entirely and write `insufficient / missing_source_field` — no API spend on unanswerable questions. |
| Truncated session head (`resumed_fragment`) | stage 1 flag in packet | J3 still runs (outcome may be judgeable from the tail) but the packet carries the flag and the prompt instructs: job_type may be `undetermined-able`; never infer what the missing turns contained. |
| Packet exceeds context budget even after truncation rules (pathological 76-turn sessions) | packet builder | Deterministic second-level truncation: keep first 3 + last 10 turn digests + all turns with friction/failure marks, note the elision count in the packet. If still over budget → `insufficient / packet_overflow` (write it, move on). |
| Model returns schema-invalid output twice | validator | `enrich_error / schema_failure` row; treated as abstention downstream. |
| Model abstains (`verdict: insufficient`) | schema | Stored with its reason enum; UI renders these as their own slice ("unclassified: N"), never folded into a real category and never dropped from denominators. |
| API unavailable / job skipped entirely | runner | The whole column set stays NULL; stage 4 aggregates over rule-only verdicts and the UI flips those views to their degraded captions (per `docs/plans/ui.md`). |

The machine-readable `insufficient_reason` space (shared across jobs):
`missing_source_field | packet_overflow | unreadable_context | other` for model/builder
abstentions (`unreadable_context` = the model read the packet and could not parse what it
describes; `other` = an abstention that fits no named branch — kept so the model is never
forced to misfile one), plus the error-row reasons the runner writes itself
(`schema_failure`, transport errors).

The invariant behind all rows: **every selected record gets exactly one row per job per
prompt version — a real judgment, an abstention with reason, or an error** — so
denominators are always exact and "the model couldn't say" is always a visible, counted
outcome rather than silence.

## Cost & scale envelope (this dataset)

J1 ≈ low hundreds of calls; J2 ≈ 763 turns in ~116 batched calls (+92 correction
judgments inside the same batches); J3 = 116; J4 < 10; J5 = 250 single-record calls
(batchable to ~25). Total well under 1,500 requests, one-shot, fully cached thereafter.
Model tier: a small fast model for J1/J5 (snippet-level reads), a stronger model for
J2/J3/J4 (contextual judgment) — both pinned by id in the run manifest.
