# ETL Architecture — the offline pipeline, technically

The concrete technical plan for ingesting, processing, and re-writing the trace data.
This is an **offline, prerequisite process**: it runs to completion before the
application serves anything, and the app reads only its outputs. Companion docs:
`docs/architecture/overview.md` (stage concept), `docs/architecture/derivations.md` (fields), `docs/architecture/llm.md`
(enrichment jobs).

## Stack

- **TypeScript end-to-end on Bun.** Bun ≥ 1.1 as runtime, package manager, bundler and
  test runner — one toolchain, no `tsc`/`node`/`npm` split. ESM, strict mode.
- **DuckDB** (`@duckdb/node-api`, the official N-API native binding — Bun implements
  N-API, so it loads as-is; verify at scaffold time and pin the working version) as the
  *processing* engine: reads the JSONL natively, holds all intermediate stage tables in
  one local database file, does every join/window/aggregate in SQL.
- **SQLite via `bun:sqlite`** — Bun's built-in native SQLite driver (no dependency at
  all, synchronous, fast) — for two roles:
  1. the **LLM cache**, and
  2. an **optional local-inspection artifact** (`--sqlite`; NOT the serving artifact —
     serving is the stage-5 Parquet tree).
- **Parquet** — the published serving tree (stage 5) doubles as the machine-readable
  deliverable.
- **Zod** for every boundary schema (raw-row validation, rule tables, LLM structured
  outputs); **OpenAI JS client** for enrichment calls (Bun-compatible); **`bun test`**
  for tests.
- No Docker required — DuckDB and SQLite are in-process. (If we later swap serving to
  Postgres, that's the one component that would move into a container; the stage
  boundary already isolates it.)

## Repository layout

```
etl/
  cli.ts                 # entrypoint: etl run | etl run --stage N | etl enrich --job J2 …
  stages/
    s0_raw.ts            # JSONL → raw.* tables
    s1_clean.ts          # validation, gates, identity flags
    s2_derive.ts         # row-level facts (SQL + rule-table application)
    s3_enrich/           # LLM jobs (see below)
      runner.ts          # batching, cache, retry, abstention writing
      jobs/j1_failure.ts … j5_audit.ts
      packets.ts         # deterministic context-packet builders + truncation
    s4_aggregate.ts      # signatures, incidents, timelines over merged verdicts
    s5_publish.ts        # partitioned Parquet serve tree + manifest + latest.json
  rules/
    signatures.yaml      # anchored failure signatures + curated metadata (versioned)
    tool_families.yaml
    thresholds.yaml      # gap cap, quick-restart window, sample sizes, seeds
  schemas/               # zod: raw rows, rule files, enrichment outputs
  lib/                   # duckdb session, manifest, hashing
build/                   # gitignored outputs
  pipeline.duckdb        # stages 0–4 live here as schemas raw/clean/derive/enrich/agg
  serve/<run_id>/…       # published serving tree (stage 5) — the artifact the app reads
  serve/latest.json      # atomic pointer to the current run
  inspect.sqlite         # optional local-inspection artifact (--sqlite)
  llm_cache.sqlite       # enrichment cache (survives `etl clean`)
  manifest/<run_id>.json # run manifests
```

## Execution model

One command, full re-run, seconds of wall time for stages 0–2/4–5; stage 3 is the only
slow/priced stage and is independently skippable/resumable.

```
bun etl run                # 0→5, enrichment included if cache/API available
etl run --no-enrich        # 0→2, 4→5 over rule-only verdicts (degraded mode)
etl run --stage 4          # re-run one stage from its predecessor's tables
etl enrich --job J3        # run/resume a single enrichment job
etl enrich --recache       # ignore cache (explicit flag, never default)
```

Each stage: reads only the previous schema, `DROP … CASCADE` + rebuild of its own schema
(idempotent by construction), then writes row counts and gate results into the run
manifest. A failed gate aborts before the next stage starts.

### Run manifest

`manifest/<run_id>.json`: input file SHA-256s, git rev, rule-file hashes, threshold
values, per-stage row counts, gate outcomes, enrichment coverage (per job: judged /
abstained / error / cached-hit counts), model ids + prompt versions, wall times. The
published `manifest.json` carries the `run_id` and coverage so any UI number traces to one
manifest.

## Stages

### Stage 0 — RAW
`read_json_auto` over `data/*.jsonl` → `raw.traces`, `raw.observations`, verbatim.
Zod spot-validation of a sample per file (fail fast on schema drift), full row counts
into the manifest.

### Stage 1 — CLEAN → `clean.turns`, `clean.observations`
- Referential gates: `observations.traceId ⊆ traces.id`; `traces.observations` id lists
  consistent. **Fork gate**: overlapping turn-number ranges per (auditor, client) →
  **abort the run** with a report (zero expected).
- Flags: `resumed_fragment`, `missing_turns`, `output_missing`, `usage_missing`,
  `is_demo_traffic` (client = tealstone OR user = demo).
- Typing: timestamps → TIMESTAMPTZ, metadata flattened to columns.

### Stage 2 — DERIVE → `derive.tool_events`, `derive.turns`, `derive.sessions`
Pure SQL + rule application; no network, no models. Everything in `docs/architecture/derivations.md`
marked structural/heuristic/curated:
- Signature matching: `rules/signatures.yaml` compiled to anchored regexes, applied in
  one pass; emits `matched_signature_id` + rule version. Curated metadata
  (`signature_class`, `counts_as_failure: true|false|uncertain`) joins in from the same
  file.
- Marker flags + `typed_prefix_chars`; gap arithmetic; `post_failure_shape`;
  repeat chains; per-turn and per-session rollups; enrichment candidate flags
  (`short_typed_after_short_gap`, J1 selector, J5 seeded samples).
- **This is where the unit tests concentrate** (see Testing).

### Stage 3 — ENRICH → `enrich.j1_verdicts` … `enrich.j5_audit`
Per `docs/architecture/llm.md`. Mechanics:

- **Client**: the OpenAI Node client with structured outputs — each job's zod schema is
  converted to JSON Schema and passed as `response_format`; parse + zod-validate on
  return. `baseURL`/model come from env, so any OpenAI-compatible endpoint (including a
  local one) works without code changes.
- **Cache**: `build/llm_cache.sqlite` via `bun:sqlite`, one table:
  `cache(key TEXT PRIMARY KEY, job, packet_hash, prompt_version, model_id, response_json,
  created_at)` where `key = sha256(job|packet_hash|prompt_version|model_id)`.
  Synchronous native reads make the hit path effectively free; WAL mode; the file
  survives full pipeline rebuilds and is deleted only by `etl enrich --recache`.
- **Runner**: builds packets deterministically (`packets.ts` is pure and unit-tested —
  packet stability *is* cache correctness), batches under the token budget, dispatches
  with bounded concurrency (p-limit ~8) and exponential backoff on 429/5xx; one
  schema-repair retry per record, then an `enrich_error` row. Writes verdict/abstention/
  error rows transactionally per batch, so a killed run resumes at the record level.
- **Invariant check** at job end: every selected record has exactly one row; coverage
  numbers go to the manifest.

### Stage 4 — AGGREGATE → `agg.failure_signatures`, `agg.incidents`, `agg.auditor_timeline`, `agg.capability_gaps`
- Builds the **merged failure verdict** per tool_event:
  `rule (counts_as_failure=true) → failure` · `rule-uncertain + J1 → J1's verdict` ·
  `rule-uncertain, no J1 → uncertain` — materialized as
  `failure_verdict ∈ {rule, model_added, model_cleared, uncertain, none}` so every
  aggregate can expose its provenance split.
- Signature/incident rollups, terminal rates, post-failure-shape distributions, rate
  excursion detection (thresholds from `rules/thresholds.yaml`), auditor timeline,
  capability-gap evidence counts joined with J4 names, J5 audit → error-bar estimates
  attached to `agg.failure_signatures`.
- Runs identically with or without `enrich.*` rows (NULL-tolerant joins; degraded
  columns flagged).

### Stage 5 — PUBLISH

**The serving artifact is time-partitioned Parquet delivered statically to the browser**
— there is no query API. The frontend fetches a manifest, pulls only the partitions its
time window touches, caches them immutably (content-addressed by run id), and queries
them client-side with DuckDB-WASM. The Parquet files are simultaneously the README's
machine-readable deliverable — one contract for both consumers.

```
build/serve/latest.json                     atomic pointer: { run_id, published_at } — the only mutable object
build/serve/<run_id>/manifest.json          partitions, date coverage, enrichment coverage
build/serve/<run_id>/facts/turns/day=<date>.parquet
build/serve/<run_id>/facts/tool_events/day=<date>.parquet
build/serve/<run_id>/ref/sessions.parquet   ← reference plane: always fetched whole
build/serve/<run_id>/ref/failure_signatures.parquet, incidents, capability_gaps,
                     gap_sessions, findings, auditor_timeline, dims
```

Two planes:
- **Fact plane** (turns, tool_events): partitioned by event date. Honestly
  time-sliceable; grows linearly with real telemetry; the browser's window determines
  which files it ever downloads. All filter dimensions denormalized per the contract
  below.
- **Reference plane** (sessions + all precomputed aggregates): global, small, fetched
  whole. Sessions span windows (one spans 27 days) and aggregates (incidents, error
  bars, findings) are computed over the full dataset — slicing them would silently
  recompute different answers per view.

**Window semantics** (enforced by the frontend, documented here because the partition
layout assumes them): fact-grain views use **event-timestamp membership** (the ops side
is entirely this — CloudWatch semantics); session-grain views (the product side's
ledgers) use **whole containment** — a session counts only if it began *and* ended
inside the window — paired with a visible "N overlapping sessions excluded" caption.
Containment causes edge censoring on trends (long sessions vanish near window
boundaries); the default window is the full dataset range, and the caveat is displayed,
not hidden.

The former thin-API rule carries over unchanged one level down: **anything filterable is
computed from fact partitions at query time (in the browser); only what cannot be
recomputed from facts ships precomputed in the reference plane.**

An optional SQLite inspection artifact is available via `etl run --sqlite` (never
served). The `build/serve/` tree is the POC mapping of infrastructure.md's `/runs/`
object-store layout — that doc's layout (including `latest.json` as the only mutable
object and the reserved future `rollups/` directory) is the interface; this stage
implements it locally.

Table contents:
- **Fact plane** — every filter dimension denormalized onto every row (client, entity,
  auditor, date, `is_demo_traffic`, and `job_type` pushed down from the session — the
  ops pages filter by it too, a deliberate cross-half dependency):
  - `facts/turns` — incl. **user/assistant text** (the session viewer's transcript),
    marker flags, gaps, friction fields.
  - `facts/tool_events` — incl. `matched_snippet` (±300 chars around the match, for
    evidence popovers), `failure_verdict` provenance
    (`rule | model_added | model_cleared | uncertain | none`), pattern id.
- **Reference plane**:
  - `ref/sessions` — full outcome enum
    `completed | abandoned | undetermined | unclassified | NULL` (unclassified =
    enrichment abstention/error; NULL = job not run — the UI renders all three
    differently), `outcome_evidence`, `dominant_linked_signature` (session-grain rollup
    for the crossover chip), friction rollups, integrity flags, first/last timestamps
    (the containment predicate's inputs).
  - `ref/failure_signatures` (curated metadata + J5 error bars), `ref/incidents`
    (detected windows + blast radius + linked friction cost — bands are global
    annotations and stay global under filtering, a documented caveat),
    `ref/capability_gaps` + `ref/gap_sessions` bridge (exemplar links), and
    `ref/findings` — the landing-page cards, built by versioned threshold rules from
    `rules/findings.yaml`, each row = claim params, audience, metric, sparkline data,
    target-URL params, provenance class, and `requires_enrichment` (rows with `false`
    are exactly the degraded-mode card set).
- **Stable public keys**: signature `pattern_id`s and capability-gap ids come from the
  versioned rule files, never from per-run sequences — deeplink URLs
  (`/ops?signature=portal-auth-403`) survive re-runs.
- `manifest.json` carries run id, partition list + date coverage, and per-job enrichment
  coverage (judged/abstained/error counts) — the UI reads this to pick partitions and
  flip degraded captions.

## Testing

- **Stage 2 is the tested core**: golden-file tests for signature matching (real output
  snippets from the dataset, including the known traps — `82,403,527.00` must NOT match,
  `AskUserQuestion` exit-1 must match-but-uncertain), gap/bout arithmetic, marker flags
  on composite messages, packet builders (byte-stable output for a fixed input).
- Stage 1 gates: synthetic fixtures for fork/referential violations (must abort).
- Stage 3: runner tested against scripted responses at the client seam (cache hits, retry path, abstention
  invariant); no live-API tests.
- Stages 4/5: one end-to-end run on a checked-in 5-session fixture slice; assert
  published view shapes and a handful of known aggregate values.
- Honest gap: enrichment *quality* is not unit-testable; it is monitored via J5 and the
  evidence-pointer validation instead.

## Deliberately not built

Incremental ingest, schedulers, streaming, a queue for enrichment (1,500 one-shot calls
don't need one), Docker for the databases (in-process engines), and any ORM — SQL is the
program here, and the stage files keep it reviewable.
