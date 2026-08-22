# ETL Testing Plan

Testing philosophy and harness design for the pipeline in `docs/plans/etl.md`. This doc
governs *how* tests are written; `docs/plans/etl.md` §6 lists *what* is covered and
defers here for method. Runner: `bun test`.

## 1. Philosophy

**Integration-first.** A test invokes a real top-level entrypoint — the CLI stage
sequence, a single `Stage` through the real executor, a `JobSpec` through the real
runner — and asserts primarily on **final observable state**: rows in DuckDB schemas,
published Parquet files, manifest contents, cache rows, exit codes. Spies assert
*interior behavior* only where the interior is the contract (a cache hit occurred,
backoff fired twice, a gate was evaluated). We do not test private functions through
their own back doors; if a behavior matters, it is observable from an entrypoint or via
a spy on a declared seam.

**Mocks are a last resort.** Anything runnable runs for real: DuckDB (real database in
a temp dir), `bun:sqlite` cache (real temp file), the filesystem/publish layout (real
temp dirs), rule YAML (real files). The single sanctioned mock boundary is the LLM
client seam (§4) — because tests must never depend on an async external third-party
service. There is no second exception.

**The harness owns the plumbing.** Tests stay declarative — stage data, run entrypoint,
assert state — because one shared harness absorbs instantiation, wiring, spy
installation, and teardown.

## 2. The harness (`test/harness.ts`)

One factory per test (or per `describe` block where tests are read-only against the
same run), providing:

| Responsibility | Detail |
|---|---|
| Temp workspace | Fresh temp dir per test: DuckDB file, `build/serve/` publish root, cache sqlite, manifest dir. Deleted on teardown (kept on failure with the path printed, for autopsy). |
| Real RunContext | Constructs the same `RunContext` the CLI builds — real rules (default: the production `etl/rules/*.yaml`; overridable with test-variant rule files for gate/threshold cases), real logger routed to a capture buffer, real manifest recorder. |
| Fixture staging | Copies a named fixture set (§6) into the workspace as the `data/*.jsonl` inputs. |
| Entrypoints | `runPipeline(flags)` (the real CLI path, in-process), `runStage(n)`, `runJob(jobId)` — all the production code paths, no test-only forks. |
| LLM seam control | `injectResponses(script)` — installs the scripted client (§4). Default if not called: the **no-credentials trap** (§5). |
| Spies | `spy(target)` helpers over the declared seams: client calls, cache get/put, gate evaluations, backoff sleeps (sleep is injected so backoff tests don't wait). |
| State probes | Query helpers against the real DuckDB (`rowsIn('derive.tool_events')`, `manifest()`, `publishedFiles()`, `cacheRows()`) so assertions read final state, not internals. |
| Env scrubbing | Deletes `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `ETL_MODEL_*` from the test process env before every test. Non-optional. |

Lifecycle: `create → stage fixtures → (inject responses) → run entrypoint → assert
state/spies → teardown`. The harness is itself covered by the canary tests in §5.

## 3. Test taxonomy

Mapped to `docs/plans/etl.md` §7 milestones; every family below runs through real
entrypoints.

**Stage-level integration (M1).** `runStage` for s0–s2 against fixture JSONL; assert
row counts, specific derived rows (the golden signature cases as *rows in
`derive.tool_events`*, not just regex unit checks — the compiled-ruleset unit tests
from etl.md §6 remain as a fast inner loop, but the authority is the stage-level
assertion), marker flags, gap arithmetic, seeded J5 sample stability.

**Gate/abort integration (M1).** `runPipeline` against fork-violation and
referential-violation fixtures; assert exit code 2, abort *before* the next stage's
schema exists, and the gate report in the manifest. Gate behavior is only trusted as
observed through the real executor.

**Full-pipeline (M2).** `runPipeline({noEnrich: true})` on the 5-session slice: assert
the published partition file set, reference-plane files, manifest coverage (all-NULL
enrichment), `latest.json` pointer, and ~a dozen known aggregate values. Then the same
slice with injected responses (M3): assert the enriched deltas and that *no other*
values changed — the degradation contract, exercised.

**Publish atomicity (M2).** Kill the pipeline (injected fault) after partition writes
but before pointer swap; assert `latest.json` still references the prior run and the
half-written run dir is inert. Re-run; assert clean recovery.

**Enrichment-runner response matrix (M3).** The heart of the LLM testing: `runJob`
with scripted responses per §4; assert both interior behavior (spy: call/retry/backoff
counts, cache hits) and final state (verdict/abstention/error rows, the
exactly-one-row invariant, manifest coverage numbers, exit code 3 on invariant
violation).

**Resume/cache integration (M3).** Run a job, kill mid-batch (injected fault after N
writes), re-run with the same cache file: assert no duplicate rows, previously-written
records untouched, spy shows zero client calls for cached records.

## 4. The LLM response matrix

Injection happens at the `client.ts` seam — the one module that talks to the `openai`
SDK. The scripted client is response-injection, not behavior simulation: the real
runner, real zod validation, real repair loop, real cache, and real writers all
execute. A script is an ordered list of per-call outcomes: `valid(json)`,
`invalid(json)`, `malformed(text)`, `http(429|500)`, `timeout`.

Cases, per job schema family (schemas in `docs/architecture/llm.md`):

**Happy paths — every enum branch produces a row with the right shape:**
- J1: `failure` and `non_failure` for each `reason` branch; `confidence` both values.
- J2: each `friction_cause` branch; `linked_signature_pattern` present and null;
  `is_correction` both values on a candidate turn.
- J3: each `job_type`; each `outcome` including `undetermined` (a *judgment*, asserted
  distinct from abstention in the written row); `ended_mid_work` both values.
- J4: valid naming with exemplar ids ⊆ input ids.
- J5: each of `missed_failure | correct | false_positive`.

**Sad paths — one test per row, asserting interior + final state:**

| Script | Expected interior (spies) | Expected final state |
|---|---|---|
| `invalid` then `valid` | 2 calls; repair prompt includes validation error | normal verdict row |
| `invalid` × 2 | 2 calls, stop | `enrich_error / schema_failure` row |
| `malformed` (non-JSON) ×2 | same as invalid path | `enrich_error` row |
| `valid` abstention, each `insufficient_reason` | 1 call | abstention row with reason, counted in coverage |
| `http(429)` ×2 then `valid` | backoff invoked twice (injected sleep) | normal verdict row |
| `http(500)` persistent | bounded retries then stop | `enrich_error` row; job continues to next record |
| `timeout` then `valid` | 1 timeout + 1 retry | normal verdict row |
| J2 `valid` with dangling `linked_signature_pattern` | post-hoc validation fires | row written with `friction_cause` downgraded to `none` + flag |
| J4 `valid` with exemplar id ∉ input | validation fires | `enrich_error` row (model invented data) |
| Packet-builder skip (load-bearing field missing) | **zero** client calls | `insufficient / missing_source_field` row |
| Oversized packet after elision | zero client calls | `insufficient / packet_overflow` row |
| Every script above, any mix | — | **invariant holds: exactly one row per selected record**; violation ⇒ exit 3 |

The matrix is table-driven: one fixture record per job + the script list, so adding a
schema branch adds a table line, not a test file.

**Batch grain**: scripts are per *call*, and calls are batch-grain where the job batches
(J2 packs many turns of one session per call, per `docs/architecture/llm.md`). A
scripted outcome therefore applies to every record in that call — and the matrix
includes one J2 case asserting that a double-invalid *batched* call yields
`enrich_error` rows for **all** records in the batch (and only those), with the
exactly-one-row invariant still holding across the session.

## 5. Escape-hatch enforcement (designed, and itself tested)

Two independent layers, both deliberate:

1. **Env scrubbing** (harness, every test): no credentials exist in the test process.
2. **Fail-loud client construction**: `client.ts` refuses to construct a real client
   without an explicit key — there is no anonymous/default endpoint path — so any call
   that escapes injection throws immediately (`MissingCredentialsError`), it does not
   attempt the network.

**Canary tests** assert the trap works: (a) run a job with *no* `injectResponses` →
expect the job to fail fast with `MissingCredentialsError`, zero rows written, non-zero
exit; (b) a script shorter than the selected record count → the overflow call hits the
trap, same failure, and the error names the job + record for diagnosis. If someone
later adds a default base URL or an env fallback, the canaries break — that is their
job.

## 6. Fixture strategy

Same fixture assets as `docs/plans/etl.md` §6, reframed for integration use:

- **Golden snippet fixtures** double as both unit inputs (fast ruleset loop) and rows
  *inside* staged JSONL fixtures, so each named trap case is asserted where it counts:
  in `derive.tool_events` after a real s0–s2 run.
- **The 5-session slice** (resumed-fragment, platform-limit, browser-heavy, clean
  single-turn, abstention-case sessions) is the full-pipeline fixture; its expected
  aggregate values are checked in as a small expectations file next to it, with a
  comment per value explaining its provenance.
- **Synthetic violation fixtures** (fork, referential, timestamp edge cases) are
  hand-built minimal JSONL — small enough to read.
- **Response scripts** live beside the tests that use them, built from typed helpers
  (`valid(...)` etc.) so scripts are compile-checked against the job's zod schema —
  a script that drifts from the schema fails at typecheck, not at runtime.
- Fixtures are checked in, never generated at test time; regeneration is a script
  (`bun run fixtures:rebuild`) whose diff is reviewed like code.

## 7. CI execution

- `bun test` runs the full suite; target **< 60 s** total (DuckDB on 5-session
  fixtures is milliseconds; the budget exists to keep anyone from "optimizing" tests
  into mocks — if the suite gets slow, fix fixtures, not realism).
- Temp-dir hygiene: workspaces under the OS temp root with the test name embedded;
  failure keeps the dir and prints the path; CI uploads kept dirs as artifacts.
- Determinism: seeds from `thresholds.yaml` (J5 sampler), injected clock for `run_id`
  in tests, injected sleep for backoff. A repeated CI run must be byte-identical in
  assertions (Parquet metadata timestamps excluded from comparisons).
- Ordering: tests are independent (own workspaces); no shared state, no serial
  requirement beyond Bun defaults.

## 8. Reconciliation with `docs/plans/etl.md` §6

This philosophy supersedes two framings in etl.md §6 (edited there to match):

- "Runner: **mock client**" → runner tests use the **response-injected client seam**
  through the real runner (§4); the word "mock" is reserved for what we don't do.
- "run through all stages **with a mocked model**" (end-to-end) → "with scripted
  responses at the client seam".

Unchanged and still authoritative in etl.md §6: the golden-case inventory, fixture
slice composition, gap/bout and packet-builder coverage, and the explicit non-goal
(enrichment *quality* is J5's runtime job, not a test concern).
