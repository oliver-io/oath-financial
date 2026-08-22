# ETL Implementation Plan

The developer-facing plan for building the pipeline specified in
`docs/architecture/etl.md` (stages, storage) and `docs/architecture/llm.md`
(enrichment jobs), producing the fields specified in
`docs/architecture/derivations.md`. Code-free: this describes modules, flows, and
conventions a developer implements directly. Where this plan and the architecture docs
disagree, the architecture docs win and this plan gets fixed.

## 1. Toolchain

| Concern | Choice | Notes |
|---|---|---|
| Runtime / PM / tests | **Bun ≥ 1.1** | `bun install`, `bun test`, `bun run`; no Node, no tsc build step (Bun executes TS directly; typecheck via `bunx tsc --noEmit` in CI). |
| Processing engine | **`@duckdb/node-api`** (pinned exact version) | N-API binding; first scaffold task is a smoke test under Bun — if it fails to load, fallback is spawning the `duckdb` CLI with the same SQL files (the SQL-in-files convention below makes this a swap of the executor only). |
| SQLite (LLM cache, optional inspect artifact) | **`bun:sqlite`** | Built-in, native, synchronous. |
| Validation / schemas | **zod** | Single schema source for: raw-row spot checks, rule files, enrichment outputs, manifest shape. Types are inferred from zod — no hand-written duplicate interfaces. |
| LLM client | **`openai`** (official JS SDK) | Structured outputs via JSON Schema (`zod` → JSON Schema through the SDK's zod helper). `baseURL`/`model`/key from env only. |
| YAML rules | **`yaml`** | Parsed once at startup, zod-validated, then treated as immutable. |
| CLI parsing | **`util.parseArgs`** (stdlib) | Two subcommands (`run`, `enrich`) don't justify a framework. |
| Concurrency | **`p-limit`** | Only for the enrichment runner. Everything else is sequential by design. |
| Lint / format | **Biome** | One tool, one config, CI-enforced. |

Dependency budget: the five packages above (`@duckdb/node-api`, `zod`, `openai`,
`yaml`, `p-limit`) plus dev-tooling. Anything beyond requires a written justification in
this file.

## 2. Module layout & dependency direction

```
etl/
  cli.ts                    parse args → construct RunContext → execute stage sequence
  context.ts                RunContext: duckdb session, loaded rules, manifest recorder, logger
  stages/
    s0_raw.ts … s5_publish.ts        one module per stage, each exporting a Stage
    sql/                    ALL SQL lives here as .sql files, one per output table,
                            named <stage>_<table>.sql (e.g. s2_tool_events.sql)
    s3_enrich/
      runner.ts             generic job executor (selector→packets→cache→call→write)
      jobs/                 j1…j5, each exporting a JobSpec
      packets.ts            pure packet builders + truncation (versioned constants)
      client.ts             OpenAI wrapper: structured-output call, backoff, repair retry
      cache.ts              bun:sqlite cache (get/put by composite key)
  rules/
    signatures.yaml  tool_families.yaml  thresholds.yaml  findings.yaml
  schemas/
    rules.ts  enrichment.ts  manifest.ts  raw.ts      (zod; all exported types originate here)
  lib/
    duckdb.ts               open/close, runSqlFile(name, params), query helpers
    manifest.ts             recorder: stage counts, gate results, coverage → manifest JSON
    hash.ts                 sha256 helpers (file, object, packet)
    log.ts                  structured line logger (stage, event, counts) — no console.* elsewhere
test/
  fixtures/                 golden snippets + the 5-session slice (see §6)
  …mirrors etl/ structure
```

**Dependency direction is one-way**: `stages/*` → `lib/*` + `schemas/*`; stages never
import each other (their only interface is the DuckDB schemas, per the architecture);
`s3_enrich/jobs/*` → `runner.ts` contract, never sideways. `cli.ts` is the only module
that sequences stages.

**SQL is the program** for stages 0–2 and 4–5: each derived table is one reviewable
`.sql` file with a header comment stating its output columns and the
`derivations.md` entries it implements. TypeScript around it does orchestration,
rule-injection, and validation — not row-by-row data manipulation. (Two exceptions
where TS touches rows: signature regex application if DuckDB regex proves insufficient,
and packet building — both pure-function modules.)

## 3. Core contracts (described, not coded)

- **`Stage`**: name; list of SQL files it executes in order; optional pre-gates and
  post-gates (predicates over queries — e.g. fork gate, referential gate); post-run
  row-count report. The executor in `cli.ts`: drop stage schema → run files → run gates
  → record manifest → abort the sequence on any gate failure. Idempotence comes from the
  drop-and-rebuild, not from cleverness.
- **`RuleSet`**: the four YAML files parsed + zod-validated into frozen objects at
  startup; each carries a content hash recorded in the manifest. Signature rules compile
  to anchored regexes once; a rule failing to compile is a startup error, not a runtime
  skip. Rules are *injected* into SQL as a DuckDB temp table (not string-spliced), so
  SQL files stay static and reviewable.
- **`JobSpec`** (enrichment): id; selector (SQL file returning record keys + packet
  inputs); packet builder (pure fn: row → packet object); zod output schema; prompt
  template + `prompt_version` string; writer (SQL insert of verdict/abstention/error
  rows). The **runner** owns everything generic: cache lookup by
  `sha256(job|packet_hash|prompt_version|model)`, batching under the token budget,
  `p-limit` concurrency, backoff on 429/5xx, one schema-repair retry, transactional
  batch writes, and the end-of-job invariant check (every selected key has exactly one
  row) — a failed invariant is a hard error.
- **`ManifestRecorder`**: accumulates per-stage entries during a run; `finalize()`
  writes `manifest/<run_id>.json` and, in stage 5, embeds the same content in the
  published `manifest.json` + repoints `latest.json` last (publish is: write everything
  under the new run dir, fsync, then swap the pointer — atomicity by ordering).

## 4. Functional flow, end to end

1. `bun etl run [--no-enrich] [--stage N] [--sqlite]`
2. Load + validate rules → RunContext (fresh `run_id` = timestamp + input-hash prefix).
3. s0: ingest JSONL (`read_json_auto`), zod spot-check sample, counts.
4. s1: typing, flags, gates (referential, fork). Gate failure → abort with report.
5. s2: facts. Rule temp-tables injected; every `.sql` file maps 1:1 to a
   `derivations.md` section; enrichment candidate flags + seeded J5 samples
   (seed from `thresholds.yaml`) computed here.
6. s3 (skippable): jobs J1→J2→J3, then J4; J5 anytime. Cache-first; coverage → manifest.
7. s4: merged `failure_verdict`; aggregates; incident excursion windows; NULL-tolerant
   over missing enrichment.
8. s5: fact-plane Parquet partitioned by day, reference-plane Parquet whole,
   `manifest.json`, pointer swap. Optional `--sqlite` inspect artifact.
9. Exit code reflects: 0 success / 2 gate failure / 3 enrichment invariant failure.

## 5. Conventions (cleanliness & docs)

- **Column names in SQL match `derivations.md` exactly.** A drift is a bug in one of
  the two; fix the source of truth deliberately (and log it in the progress log if the
  spec moves).
- Module headers: one comment block per stage/job file stating its contract (inputs,
  outputs, gates) — the file should be readable without opening the architecture doc,
  but defers to it.
- Comments state constraints and known-unhandled cases, not narration. The known
  false-positive/negative modes of each signature belong in `signatures.yaml` as
  `notes:` fields, surfacing in the UI's evidence popovers — documentation as data.
- No silent catches. Errors either abort the stage or become typed abstention/error
  rows (enrichment only). `log.ts` emits structured lines; nothing else prints.
- Env handling in one place (`context.ts`): `OPENAI_API_KEY`, `OPENAI_BASE_URL`,
  `ETL_MODEL_*`; absence of key + enrichment requested = clear startup error, not a
  mid-run surprise.
- Determinism: no `Date.now()`/randomness outside `run_id` and the seeded sampler;
  packet builders and truncation are pure and versioned — changing truncation without
  bumping `prompt_version` is a cache-poisoning bug, called out in `packets.ts`'s
  header.

## 6. Testing plan (`bun test`)

Method is governed by `docs/plans/etl_testing.md` (integration-first: real entrypoints,
real DuckDB/cache/filesystem, response-injected LLM seam — mocks are a last resort).
This section lists coverage.

- **Golden signature tests** (the critical mass): a fixtures file of real output
  snippets from `data/observations.jsonl` — each known trap is a named case
  (`amount_403_must_not_match`, `askuserquestion_exit1_uncertain`,
  `agent_generic_error`, `platform_limit_marker`, portal/CLI/read signatures). Runs
  the compiled rule set against snippets; asserts signature id + counts_as_failure.
- **Marker/prefix tests**: composite messages (typed prefix + extract paste),
  sub-1k skill stubs, marker-anywhere matching.
- **Gap/bout arithmetic**: synthetic timestamp sequences incl. cap boundaries, the
  final-gap-unknowable case, single-turn sessions.
- **Gate tests**: synthetic fork/referential violations must abort with exit 2.
- **Packet builders**: byte-stable output for fixed input (snapshot tests); truncation
  edge cases (76-turn session digest, oversized packet → structured elision → overflow
  abstention).
- **Runner**: response-injected client seam through the real runner — cache hit path,
  repair-retry path, invariant violation, transactional resume after simulated kill
  (full response matrix in `docs/plans/etl_testing.md` §4).
- **End-to-end**: a checked-in 5-session fixture slice (chosen to include: one
  resumed-fragment, one platform-limit session, one browser-heavy, one clean single-turn,
  one enrichment-abstention case) run through all stages with scripted responses at the
  client seam; assert published partition file set, manifest coverage numbers, and ~a
  dozen known aggregate values.
- Explicit non-goal: testing enrichment *quality* (that's J5's runtime job).

## 7. Build order

| Milestone | Delivers | Note |
|---|---|---|
| M0 | Scaffold: Bun project, Biome, CI (`tsc --noEmit`, `bun test`), DuckDB-under-Bun smoke test | The smoke test is first because it's the one stack risk. |
| M1 | s0–s2 + rules + golden tests | The tested core; most project value. |
| M2 | s4–s5 **rule-only** (skip s3) + fixture e2e | Publishes real degraded-mode Parquet — unblocks all frontend work early. |
| M3 | s3 runner + J2/J3 (the UI-critical jobs), then J1 | Frontend flips from degraded to enriched with zero UI changes — proving the degradation contract. |
| M4 | J4/J5, findings rules, audit error bars | Last because they polish, not unblock. |

Deliberate ordering property: the frontend never waits on the LLM work, and the
degraded-mode contract is exercised for real (M2→M3), not just designed.
