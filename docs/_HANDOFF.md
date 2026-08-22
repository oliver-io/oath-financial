# _HANDOFF.md — orchestrator handoff: ETL shell → tests → readiness

Handoff for a top-level orchestrator taking the project from "architecture complete, no
code" to "ready for real implementation-level development." The task has **three phases,
in strict order**. Do not begin implementing pipeline logic — that is the phase *after*
this handoff, and the entire point of this task is to make that phase safe and boring.

## Context you must load first

Read, in this order, before writing anything:

1. `CLAUDE.md` (root) — what this project is, structure, working conventions, the
   do-not-build list.
2. `README.md`, `DATA.md`, `SCHEMA.md` (root, read-only challenge spec) — what the data
   is and its documented traps.
3. `docs/architecture/overview.md` — the six-stage pipeline concept and the two-sided
   (ops/product) app it feeds.
4. `docs/architecture/derivations.md` — **the column-level source of truth.** Every
   field the pipeline produces is specified here with a confidence class; SQL column
   names must match it exactly.
5. `docs/architecture/etl.md` — stages, storage, serving contract (time-partitioned
   Parquet, two planes, manifest, `latest.json`).
6. `docs/architecture/llm.md` — the five enrichment jobs, packet contracts, abstention
   invariant, escape hatches.
7. `docs/plans/etl.md` — the implementation plan this task executes the shell of:
   toolchain (Bun, pinned `@duckdb/node-api`, `bun:sqlite`, zod, `openai`, `yaml`,
   `p-limit`, Biome), module layout, dependency direction, core contracts, conventions,
   milestones.
8. `docs/plans/etl_testing.md` — the testing philosophy the phase-2 tests must follow.
9. `docs/PROGRESS_LOG.md` — skim for *why* decisions landed where they did; several
   obvious-looking "improvements" were tried and rejected with evidence (episodes,
   origin enum, semantic recovery labels). Do not re-introduce them.

The phase-1 agent in particular must demonstrate understanding, not just compliance:
its first deliverable is the module skeleton, and a skeleton that mirrors the docs
without understanding them will encode subtle wrongness (e.g. putting aggregation
before enrichment, collapsing the fact/reference planes, inventing an `origin` enum).
If any doc contradicts another, **stop and record the contradiction** in the phase
report rather than resolving it silently; `derivations.md` wins on fields,
`architecture/etl.md` wins on storage/stages, `plans/etl.md` wins on modules/tooling.

## Phase 1 — the ETL shell (functional architecture, no logic)

Build the complete structural skeleton of `etl/` per `docs/plans/etl.md` §2–§3:

- Bun project scaffold: `package.json` (the five runtime deps + dev tooling, versions
  pinned), `tsconfig` (strict), Biome config, `bun test` wiring, CI script stubs
  (`typecheck`, `test`, `lint`).
- **The DuckDB-under-Bun smoke test** (plans/etl.md M0's one stack risk): a tiny real
  test that opens a DuckDB database, runs a trivial query, and closes. This is the only
  phase-1 test that must genuinely pass; if the binding fails under Bun, stop and
  report — the fallback decision (CLI executor swap) is pre-authorized in the plan but
  should be recorded.
- All modules from the layout with **real signatures and no-op/`Unimplemented` bodies**:
  `cli.ts` (arg parsing real, stage sequencing calls stubs), `context.ts`, the six
  stage modules each exporting a `Stage` with its declared SQL file list and gate list,
  `s3_enrich/` (runner, client, cache, packets, five `JobSpec` stubs), `lib/*`,
  `schemas/*`.
- A shared `Unimplemented` error type (message = module + contract reference, e.g.
  `"s2_derive: see docs/plans/etl.md §3 Stage"`) so failing tests in phase 2 read as a
  to-do list.
- **Real zod schemas** in `schemas/` — these are contracts, not logic: rule-file
  schemas, the five enrichment output schemas (transcribe them exactly from
  `docs/architecture/llm.md`), raw-row spot-check schemas. Writing these forces the
  understanding this phase exists to verify. **Scope boundary:** `etl/schemas/` covers
  *internal* shapes only. The **manifest and published-table schemas belong to the
  top-level `contracts/` workspace, owned by the app-track agent**
  (`docs/_HANDOFF_APP.md`, `docs/plans/app.md` §2); the ETL adopts them for stage-5
  output validation at M2. Do not author a manifest or published-row schema in
  `etl/schemas/` — that would create two authorities for one contract.
- **Real rule-file skeletons** in `etl/rules/`: valid YAML, correct shape, minimally
  populated (signatures.yaml should carry at least the known signature families from
  derivations.md with `pattern_id`, class, `counts_as_failure`, `notes` — patterns may
  be marked provisional; they get tuned during implementation).
- Empty `.sql` files are NOT acceptable; each `stages/sql/*.sql` file must exist with
  its header comment (output table, columns per derivations.md, gates) and a body of
  `-- UNIMPLEMENTED` — the header *is* phase-1 work, the body is not.
- Everything typechecks (`bunx tsc --noEmit` clean), lints clean, and `bun etl run`
  executes far enough to fail with an `Unimplemented` error from stage 0 — not a crash,
  not a silent success.

## Phase 2 — the integration test suite (runnable, mostly red)

Per `docs/plans/etl_testing.md`, strictly:

- Build `test/harness.ts` **for real** — the harness is not a stub. Temp workspaces,
  real RunContext construction, fixture staging, `injectResponses` + the scripted
  client, spy helpers with injected sleep/clock, state probes, non-optional env
  scrubbing. The harness is the phase's main engineering artifact.
- Build the fixture assets (etl_testing.md §6): golden snippet fixtures extracted from
  the real `data/observations.jsonl` (each named trap case), the 5-session slice with
  its expectations file, synthetic violation fixtures, typed response-script helpers.
- Write the test families from etl_testing.md §3–§5: stage-level integration,
  gate/abort, full-pipeline (degraded and enriched), publish atomicity, the LLM
  response matrix (happy branches + the sad-path table including the batch-grain J2
  case), resume/cache, and the **canary tests** (no-credentials trap — these must
  PASS in phase 2, since the trap is harness+client-construction behavior that exists
  in the shell).
- Expected end state: the suite runs to completion; nearly everything fails with
  `Unimplemented` (that is correct and is the deliverable); passing tests should be
  exactly: the DuckDB smoke test, the canary tests, schema/rule-file validation tests,
  and any pure structural assertions (e.g. arg parsing). **A test that passes for any
  other reason is suspicious — investigate it; it is either testing nothing or the
  shell contains logic it shouldn't.**
- No test may be skipped/pending to make the run green. Red is the honest state.

## Phase 3 — readiness verification

An adversarial review pass (fresh agent, not the phase-1/2 authors) that answers: **is
this skeleton safe to hand to implementation-level developers?** Concretely:

- Doc↔shell congruence: every module, stage, SQL file header, schema field, and rule
  file traces to its spec; every derivations.md field has a declared home; no invented
  structures (check especially for the rejected patterns: episode merging, exclusive
  origin enum, semantic recovery labels, aggregation upstream of enrichment).
- Test↔spec congruence: every etl_testing.md family exists and runs; failure messages
  point at the right contracts; the red/green split matches the phase-2 expectation
  exactly, with each unexpected green explained.
- Toolchain reality: `bun install` from lockfile on a clean checkout → typecheck, lint,
  and full test run all behave as documented; the smoke test passes; versions pinned.
- Deliverable: a short readiness report appended to `docs/PROGRESS_LOG.md` (new
  section): what exists, the red/green tally, any contradictions found in the docs
  during the build (with proposed resolutions, not silent fixes), and an explicit
  go/no-go for implementation development.

## Deliverable priority (MDD)

The challenge README's deliverable is **insight, not infrastructure**. If time
pressures force cuts in the implementation phase that follows this handoff, the
minimum defensible deliverable is: **stages 0–2 + 4–5 in rule-only/degraded mode,
published Parquet from the real data (committed as a sample run), green M1/M2 tests.**
Enrichment (stage 3, all five jobs) is explicitly droppable — the pipeline is designed
to run without it. Nothing in *this* handoff's shell/test phases changes, but structure
the work so that ordering is preserved.

## Ground rules for all phases

- **No pipeline logic.** The temptation to "just implement s0, it's one line of
  `read_json_auto`" is the failure mode of this task. Logic arrives in the next task,
  guided by the red tests this one leaves behind.
- No new dependencies beyond `docs/plans/etl.md` §1's budget without written
  justification in that file.
- No edits to `README.md`, `DATA.md`, `SCHEMA.md`, or `data/`.
- Conventions from `docs/plans/etl.md` §5 apply to skeleton code too (module headers,
  no silent catches, env handling in `context.ts` only, structured logging).
- Update `docs/PROGRESS_LOG.md` at each phase boundary.
