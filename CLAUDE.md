# Trace Insights — project guide

## What this is

An internal observability tool for auditor Claude Code sessions, built for the coding
challenge specified in `docs/TASK.md`. Per-turn Langfuse traces (763 turns, 8,082
observations, 116 sessions, ~1 month) are ingested by an offline ETL, enriched with
deterministic facts and quarantined LLM classifications, and served as time-partitioned
Parquet to a React SPA that presents **two distinct products over the same data**:

- **Ops side** — traditional observability; the *system* is the object. Failures by
  signature, incidents, environment health. CloudWatch-style event semantics.
- **Product side** — product analytics; the *user and their work* is the object. Job
  mix, session outcomes, interaction cost, productivity-vs-wrestling, capability gaps.
  Whole-session semantics.

The two sides crossover through shared failure/incident entities (deeplinks, never
merged views). Honesty is a design axiom: every value carries a provenance class
(structural / heuristic / curated / model), abstention and "undetermined" are
first-class displayed states, and things the data cannot support are shown as explicit
non-views rather than omitted.

## Read this first

`docs/TASK.md` plus `DATA.md`, `SCHEMA.md` at the root are the **challenge-provided
spec** — treat as read-only (root `README.md` is the user-authored submission front
page, not the spec). Critical facts from them: the data's *structure* is real but all
*prose is template-generated*; session ids group turns; durations/costs/amounts are
untrustworthy; failure detection is necessarily heuristic. Traps are documented there
and extended in our own docs.

## Repository structure

```
README.md                        user-authored submission front page
DEV_LOG.md                       user-authored dev narrative — never edit
DATA.md, SCHEMA.md               challenge spec (read-only)
FINDINGS.md                      the one-page deliverable: findings, next, left-out (grader-facing)
RUNNING.md                       run instructions (grader-facing; updated as tracks land)
data/*.jsonl                     the trace dataset (read-only)
sample-output/                   committed fully-enriched sample run (Parquet + manifest)
docs/
  TASK.md                        challenge spec (read-only)
  PROGRESS_LOG.md                chronological project log (decisions + reversals)
  _HANDOFF*.md                   historical orchestration artifacts (ETL / app / infra tracks)
  architecture/                  the full specs (see BRIEF below)
  plans/                         ui.md (READY) · app.md · etl.md · etl_testing.md · infra.md
contracts/                       shared zod schemas for the serving contract + synthetic
                                 fixture pack — imported by BOTH etl and app (app-track owned)
etl/                             the pipeline, per docs/plans/etl.md (ETL-track owned)
app/                             the React SPA, per docs/plans/app.md (app-track owned)
infra/                           Pulumi AWS deployment (implemented, deployed at
                                 https://oath.oliver-io.online), per docs/plans/infra.md
build/                           (gitignored) pipeline outputs incl. serve/ artifact
```

## BRIEF — architecture summary

Full specs in `docs/architecture/`; this is the map.

**Data model** (→ `docs/architecture/derivations.md`): the **session is the unit of
analysis** (episode-merging was investigated and rejected on evidence). Entities:
`tool_event` ∈ `turn` ∈ `session`, plus `failure_signature`, `incident`,
`capability_gap`, `auditor_timeline`, and shared slice dimensions. Every field is typed
and tagged structural/heuristic/curated/model. Boundary principle: deterministic stages
compute *facts and parameterized arithmetic*; any field whose name asserts intent,
effort, success, or failure-as-experienced is model-class.

**Pipeline** (→ `docs/architecture/overview.md` for the concept,
`docs/architecture/etl.md` for the technical plan): six offline stages —
RAW → CLEAN (gates; fork detection aborts) → DERIVE (row facts, anchored signature rule
tables as versioned data) → ENRICH (LLM, optional, cached) → AGGREGATE (merged verdicts
with provenance — deliberately downstream of enrichment) → PUBLISH. TypeScript on
**Bun**; DuckDB (`@duckdb/node-api`) processes; `bun:sqlite` for the LLM cache; run
manifests make every published number traceable.

**LLM enrichment** (→ `docs/architecture/llm.md`): five independent jobs (gray-zone
failure adjudication, turn classification, session classification, capability-gap
naming, heuristic audit). The model classifies, never counts; packets embed stage-2
facts; abstention with reason is a first-class output ("exactly one row per selected
record" invariant); the J5 audit estimates the rule table's error bars. <1,500 calls,
fully cached, pipeline degrades gracefully without it.

**Serving** (→ `docs/architecture/etl.md` stage 5,
`docs/architecture/infrastructure.md`): **no application server.** Stage 5 publishes
time-partitioned Parquet (fact plane: turns/tool_events by day) plus a small global
reference plane (sessions + precomputed aggregates + findings), content-addressed by
run id under an immutable layout with a `latest.json` pointer. The browser fetches
manifest → window's partitions, caches immutably, and queries with DuckDB-WASM.
POC serves from a local static Bun server; production is object store + CDN + edge SSO —
every POC stand-in preserves its production interface.

**UI** (→ `docs/plans/ui.md`, READY; implementation plan `docs/plans/app.md`): a
hub landing routing to the two rooms — findings are a written deliverable
(`FINDINGS.md`) plus queryable `ref/findings` rows, deliberately not a UI
surface (revision 3); first-class
CloudWatch-style time-window control (**ops = event-timestamp membership; product =
whole-session containment with an excluded-count caption**); provenance chips, evidence
popovers, ghost cards for unsupported views; every path drills to a session transcript
viewer. Appearance: financial-firm restrained — ink-first slate base, ops steel-blue /
product deep teal-green, no bright colors, **no purple**, validated chart palette,
hatching as the uncertainty texture (app.md §6). Frontend developed in parallel with the
ETL against `contracts/` schemas + a synthetic fixture pack; flipped to real data at
ETL M2.

## Working conventions

- Adversarial review is the project's method: significant design elements get attacked
  by subagents against the *actual data* before they're trusted; reversals are recorded
  in `docs/PROGRESS_LOG.md`, which should be updated as milestones land.
- Thresholds and taxonomies are **versioned data files** (`etl/rules/`), never inline
  constants.
- Do not build: cost/token views, per-tool latency, auditor performance rankings,
  cross-turn amount arithmetic, prose/phrasing mining — the data cannot support them
  (see `docs/TASK.md` traps and `docs/architecture/derivations.md` "Known non-derivables").
