# Derivations — the derived data points

This document catalogs every data point the application needs to operate on, described as
**typed fields on derived entities**. It deliberately does not describe *how* each value is
computed (that's a later derivation-strategy doc) — only *what* it is, what values it can
take, and what the UI does with it.

Each field carries a **confidence class**, because the UI must render provenance honestly:

- `structural` — read directly from trace/observation structure; trustworthy.
- `heuristic` — computed by deterministic rules over text/structure (e.g. anchored error
  signatures); has known false positive/negative modes and must be displayed as such.
- `curated` — human-authored metadata applied deterministically (e.g. the class assigned
  to an error signature in the rule table). The application is mechanical; the taxonomy is
  judgment, and is versioned as data.
- `model` — produced by an LLM classification pipeline with structured output; provisional
  by construction, always accompanied by the evidence it was judged from.

**Boundary principle (from adversarial review):** the deterministic stage may compute
*facts and parameterized arithmetic*. The moment a field's **name** asserts intent,
effort, success, or failure-as-experienced, it is model-class — even when a rule
approximates it. Several fields below were fine as computations and wrong only as names;
the deterministic layer emits neutrally-named facts, and interpretation lives in the
enrichment layer or the UI.

Entity hierarchy: `tool_event` ∈ `turn` ∈ `session`. **The session is the unit of
analysis.** We examined and rejected merging adjacent sessions into "episodes": the only
hard continuation evidence in this dataset is one telemetry-truncated session with no
predecessor to attach to, there is zero fork evidence (no overlapping turn numbering), and
textual continuation markers turned out to be template noise (a "thanks — that's what I
needed" opener whose temporal predecessor ended on a login failure). Sessions started
minutes apart are presumed to be distinct tasks that may share causal dependencies —
which is not continuation. Failures roll up into `failure_signature` and `incident`.
Dimensions (client, auditor, job type…) are shared slice axes across both sides of the app.

---

## 1. `tool_event` — one tool invocation

| Field | Type | Class | Notes |
|---|---|---|---|
| `tool_name` | string enum (69) | structural | From `metadata.tool_name`. |
| `tool_family` | enum: `shell` · `file` · `browser` · `docstore` · `subagent` · `task` · `search` · `other` | structural | Rollup of `tool_name` for shape analysis; browser calls inflate raw counts, families normalize. |
| `seq_index` | int | structural | Position within the turn's tool sequence. |
| `matched_signature_id` | FK → `failure_signature`, nullable | heuristic | Which anchored signature matched the output text, if any. **Never** a bare substring match (amounts collide with `403`). The match is the fact; whether it *counts as a failure* is metadata on the signature (curated) — e.g. `exit 1` on `AskUserQuestion` is plausibly "user declined", not a failure. |
| `post_failure_shape` | enum: `same_tool_clean_later` · `other_calls_after` · `turn_ends_on_failure`, nullable | structural | Within-turn shape after a signature match. The 514 / 179 / 77 counts were provisional exploration numbers; the implemented pipeline measures **484 / 67 / 49** under first-match-only semantics + curated tool scoping (sig-v1) — expected drift, recorded at M1. Neutral positional fact; "recovered"/"fatal" interpretations are model-class. |
| `repeat_of` | FK → `tool_event`, nullable | structural | Set when this call's input is byte-identical to an earlier call in the same turn. Detects *identical re-invocation* — whether that is a retry (intent) is interpretation. |
| `is_agent_tool` | bool | structural | Subagent calls must be excludable from failure aggregates (their outputs are near-uniform failure templates). |

UI use: drill-down terminus on both sides; failure explorer rows; retry-loop and grind
detection inputs.

Deliberately **not** stored: per-call duration (meaningless in this telemetry), any join
between a call's input text and its own output text (independently generated — only error
*placement* is trustworthy).

## 2. `turn` — one trace

| Field | Type | Class | Notes |
|---|---|---|---|
| `session_id`, `turn_number`, `timestamp` | — | structural | Identity and ordering. |
| `gap_before_s` | float, nullable | structural | Seconds since previous turn in the same session. Null on first turns. **The only real time signal.** |
| `has_task_notification`, `has_skill_body`, `has_extract_paste` | bool ×3 | heuristic | Independent structural-marker flags on the user message (113 / 115 / 98 hits; markers matched anywhere in the message, not just as prefix). Replaces a rejected 3-way `origin` enum: size thresholds have no clean valley (the 1k–5k middle is populated; 104 marker-bearing messages are *under* 1k), and composite messages — a typed ask followed by a pasted extract, true of **all 98** extract turns — cannot be represented by an exclusive enum. |
| `typed_prefix_chars` | int | heuristic | Length of user content before the first marker (whole message if no marker) — the deterministic "human-authored portion" measure. |
| `user_chars`, `assistant_chars` | int | structural | Size, not content — size distribution is real signal. |
| `tool_count` | int | structural | |
| `error_count` | int | heuristic | Count of failure-counting signature matches (Agent tool excluded by default). |
| `max_same_tool_run` | int | structural | Longest run of one tool in this turn. A neutral count — the "grind" label is interpretation (a 75-call Bash run may be a legitimate batch loop) and belongs to enrichment/UI. |
| `identical_input_chain_count` | int | structural | Byte-identical `repeat_of` chains in this turn. Neutral count; the "thrash" label is interpretation (polling loops repeat inputs legitimately). |
| `platform_limit_marker` | bool | heuristic | Assistant output contains the org-spend-limit message ("you have hit your org's monthly spend limit" — 40 turns, 12 sessions, 6 session-terminal). A deterministic *marker*; whether it ended the session is interpretation (one session carries it in turns 1–7 and runs to turn 70). |
| `short_typed_after_short_gap` | bool | heuristic | Candidate-generator flag for correction classification (92 candidates in this data) — enrichment classifies only flagged turns instead of all 763. |
| `is_correction` | bool | model | The user re-steering. Confirmed non-deterministic: the 92 candidates mix real re-steers with plain new asks; no rule separates them. |
| `turn_friction` | float 0–1 | model | Degree to which this exchange was wrestling rather than progress (auth firefighting, workaround, re-explaining). Summed/averaged upward to sessions. |
| `friction_cause` | enum: `system_failure` · `capability_gap` · `agent_behavior` · `user_request` · `none`, nullable | model | Root-cause attribution when `turn_friction` is high. `system_failure` carries the crossover FK below. |
| `linked_failure_signature_id` | FK, nullable | heuristic | Set when `friction_cause = system_failure`: the deeplink from product-side friction to the ops-side failure entity. |

## 3. `session` — reconstructed from shared `session_id`

| Field | Type | Class | Notes |
|---|---|---|---|
| `turn_count`, `first_ts`, `last_ts` | — | structural | |
| `wall_span_s` | float | structural | Display-only with a warning affordance; never presented as effort. |
| `capped_gap_span_s` | float | heuristic | Sum of inter-turn gaps under a stated cap. Renamed from "active span": some gaps contain *agent background work* (task-notification turns arrive after gaps), so "attention"/"active" overclaims — always published alongside the cap value. |
| `bout_count` | int | heuristic | Contiguous turn bouts under the cap (renamed from "sittings" — presence of the human is not established). |
| `final_turn_tool_count`, `final_turn_error_count` | int | structural/heuristic | Neutral facts about the last turn, fed to the outcome classifier. |
| `resumed_fragment` | bool | structural | Session's turn numbering starts above 1 — the leading turns were lost by telemetry. Exactly 1 case in this data (`49d43953`, turns 22–59) and it has no predecessor in the dataset, so it is flagged, never merged. Excluded from turn-count-sensitive metrics. |
| `missing_turns` | int[] | structural | Internal gaps in turn numbering (1 case: `d1762aa9` missing 2–3). Telemetry-integrity signal (ops side). |
| `is_demo_traffic` | bool | structural | True for the tealstone client **or** the demo user (they are not the same set); excludable everywhere, shown separately. |
| `job_type` | enum: `doc_receipt_check` · `doc_location` · `doc_inventory` · `tie_out` · `extraction_supervision` · `drafting` · `capability_probe` · `other` | model | The line-of-business/work classification; primary product-side slice. `portal_auth` was removed after raw-trace inspection: no session has auth as its deliverable — auth is infra overhead/friction (ops signatures + J2 `friction_cause`), never a job (see `llm.md` J3). |
| `outcome` | enum: `completed` · `abandoned` · `undetermined` | model | `undetermined` is a first-class displayed bucket — platform kills leave no marker, so a clean completed/abandoned split would be invented. **Publish-layer mapping**: the served column extends this to `completed · abandoned · undetermined · unclassified · NULL`, where `unclassified` = enrichment abstention/error and NULL = job not run — pipeline states appended at publish (etl.md stage 5), not model judgments. |
| `outcome_evidence` | string | model | Short justification + pointer turns; rendered in drill-down so a human can audit the label. |
| `interaction_cost` | int | heuristic | Turns with a non-empty human-authored segment (`typed_prefix_chars > 0` and no harness-injection marker as the sole content). Deterministic under this definition; whether it measures *demand on the human* is interpretation. |
| `friction_share` | float 0–1 | model (rollup) | Aggregated `turn_friction`; the productivity-vs-wrestling dial. |
| `dominant_friction_cause` | enum (as turn) | model (rollup) | |
| `ended_mid_work` | bool | model | **Demoted from heuristic — refuted by data**: most tool-heavy final turns end with completed work (e.g. a 45-tool final turn producing a finished tie-out summary). The judgment consumes the deterministic final-turn facts + `platform_limit_marker` + `turn_ends_on_failure`. |
| `quick_restart_after_s` | float, nullable | structural | Seconds until the same auditor's *next* session starts, when under 1h. **Not a linkage** — a workflow-granularity fact (39 such restarts exist). Reported as-is; the next session is presumed a distinct task. |

### Rejected entity: `episode` (session merging)

An earlier draft merged time-adjacent sessions into "episodes." Rejected on evidence:
time adjacency cannot distinguish task-switching from continuation; a session that edits a
file a prior session created is a *causally dependent new task*, not a continuation; the
dataset contains **no** hard-linkable pairs (no complementary turn numbering, no forks);
and textual continuation markers are template artifacts of the data generator. If future
data carries a real parent-session pointer, collapse should happen as **data cleanup at
ingest** (rewriting session identity), not as an analytic overlay. A **fork detector**
(two sessions sharing an auditor+client with overlapping turn-number ranges) runs at
ingest as a data-quality check; it fires zero times on this dataset, and any future hits
must be resolved before session-level metrics are computed.

## 4. `auditor_timeline` — attention and rhythm (per auditor)

Time metrics never needed task identity; they are computed on each auditor's merged
timeline of all their turns, which also prevents double-counting attention across
overlapping sessions.

| Field | Type | Class | Notes |
|---|---|---|---|
| `capped_gap_span_s` | float | heuristic | Sum of inter-turn gaps under a stated cap, across all the auditor's turns per day/window. |
| `bout_count` | int | heuristic | Contiguous work bouts (gaps over the cap start a new bout). |
| `sessions_touched`, `clients_touched` | int | structural | Per bout/day. |
| `daily_turns` | int[] | structural | Activity strip for the engagement-health timeline. |

## 5. `failure_signature` — ops-side failure taxonomy

One row per recurring failure pattern, the unit the failure explorer aggregates by.

| Field | Type | Class | Notes |
|---|---|---|---|
| `signature_class` | enum: `auth_token` · `provisioning_config` · `missing_resource` · `platform_tool_fault` · `agent_code_crash` · `subagent_failure` · `platform_limit` | curated | Top level of the failures view. The taxonomy is human judgment versioned in the rule table — applied deterministically, but not computed. |
| `counts_as_failure` | bool | curated | Per-signature: whether a match is a failure at all (e.g. `exit 1` on `AskUserQuestion` is plausibly a user declining, not an error). |
| `pattern_id` / `display_name` | string | curated | e.g. "portal HTTP 403 — connector not configured". |
| `event_count`, `session_count`, `auditor_count`, `client_count` | int | heuristic | Blast radius; `auditor_count`/`session_count` is the one-off vs systemic discriminator. |
| `first_seen`, `last_seen` | timestamp | structural | |
| `daily_series` | int[] | heuristic | Time series for the failure graph; feeds incident detection. |
| `terminal_rate` | float | heuristic | Share of occurrences in a session's final turn. A co-occurrence rate — "kills work" is interpretation. |
| `post_failure_shape_dist` | distribution over `post_failure_shape` | structural (rollup) | What structurally happens after a match. The semantic labels (`self_recovered` / `user_intervened` / `fatal`) were **demoted to model-class**: a later same-tool success doesn't prove recovery of that attempt, and per-call input↔output pairing is untrustworthy in this telemetry. |

## 6. `incident` — temporal clusters of failures

| Field | Type | Class | Notes |
|---|---|---|---|
| `signature_ids` | list FK | heuristic | |
| `start_ts`, `end_ts` | timestamp | heuristic | Detected as rate excursions vs the signature's baseline (e.g. the Mar 29–31 auth spike). |
| `blast_radius` | {sessions, auditors, clients} | heuristic | |
| `linked_friction_cost` | float | model (rollup) | Total product-side friction attributed to this incident — the crossover number that says what an outage *cost in work*. |

## 7. `capability_gap` — product-side feature-request ledger

One row per recurring workaround pattern (e.g. CLI-fails→browser-grind, clipboard-ferried
extracts, shell PDF pipeline over sanctioned docstore, hand-built background pipelines).

| Field | Type | Class | Notes |
|---|---|---|---|
| `gap_id` | string | curated | **Stable public key** from the stage-2 cluster definitions in the rule files — never model-generated, never per-run (deeplink URLs depend on it; see etl.md stage 5 stable-keys rule). |
| `display_name`, description | string | model | Named and described by the enrichment pipeline (J4) — display text only, never identity. |
| `evidence_pattern` | string | heuristic | The structural shape (browser-call concentration, extract-marker turns, shell-PDF usage counts) — computed deterministically in the derive stage; enrichment only does the *naming and grouping* of gaps, never the counting. |
| `session_count`, `auditor_count` | int | rollup | Adoption of the workaround = demand for the feature. |
| `interaction_cost_estimate` | int | rollup | Turns spent inside the workaround — the ranking key for the backlog view. |

## 8. Shared dimensions (slice axes on both sides)

| Dimension | Values | Class |
|---|---|---|
| `client` / `entity` | 4 clients × entities | structural |
| `auditor` | 7 | structural |
| `job_type` | see session §3 | model |
| `turn_markers` | has_task_notification / has_skill_body / has_extract_paste (independent flags; see §2 — the exclusive 3-way origin enum was rejected) | heuristic |
| `is_demo_traffic` | bool | structural |
| `date` | day within the window | structural |

Same filter bar on both sides of the app; different metrics behind it.

---

## Known non-derivables (stated, not worked around)

- **Per-tool timing** — durations record telemetry write time. No "slowest tool" anywhere.
- **Real cost/tokens** — undercount 15–20×. No cost views; would need full-context billing export.
- **Killed vs abandoned** — largely non-derivable, with one partial exception found on
  review: an org-spend-limit message exists in 40 assistant outputs (12 sessions, 6
  session-terminal). The *marker* is deterministic (`platform_limit_marker`); attributing
  a session's end to it is not (sessions carry the marker and continue for dozens of
  turns). `undetermined` remains the honest default outcome bucket.
- **Cross-turn monetary arithmetic** — amounts are invented.
- **Per-call input↔output correspondence** — texts are independently generated; only failure placement is real.
- **Cross-auditor skill rankings** — auditors barely overlap with clients; confounded. The UI presents auditor×engagement facts, never leaderboards.
