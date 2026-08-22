# PROGRESS_LOG.md

**Goal:** solve the README.md challenge — build a tool that ingests one month of Langfuse
traces from auditor Claude Code sessions (763 turns, 8,082 observations, 116 sessions) and
produces structured insights serving two distinct audiences, Operations and Product.

**Method:** architecture-first, iterative design with adversarial review at every step —
multi-lens subagent fan-outs over the *actual data*, and deliberate challenges to our own
assumptions before any code is written. Reversals are recorded below because they are the
substance: several "obvious" designs were rejected on evidence.

---

## 1. Ingesting the problem

- Read `README.md`, `DATA.md`, `SCHEMA.md` in order; established the core frame:
  **the structure is real, the prose is generated.** Trustworthy axes: session shape,
  turn ordering, exact tool sequences, failure placement (~9% error rate), inter-turn
  timestamps. Poisoned axes: token/cost (15–20× undercount), intra-turn durations
  (telemetry write-time), monetary amounts, subtle phrasing.
- Identified the unit-of-analysis problem up front: traces are turns; **sessions must be
  reconstructed** via `metadata.session_id` + `turn_number`.
- Flagged early decisions: `tealstone` is a demo box (exclude from ops views, arguably
  keep for product); error detection must be text-heuristic and labeled as such.

## 2. Stack debate

- User proposed **Elasticsearch** for on-the-fly aggregation and a query-builder
  exploration UI; asked for adversarial challenge in both directions.
- Case against ES at this scale: classification signal is *structural*, not
  information-retrieval-shaped; session reconstruction is joins/window functions (ES's
  weakness); the whole derived dataset is ~10–20MB, so ES's caching/distribution solves a
  problem we don't have; "I stood up a JVM cluster for 8,082 rows" fails the README's
  taste test. Conceded the real ES strength: a composable JSON query DSL that mirrors
  facet-UI state — the legitimate lesson being *shape the derived tables flat and
  facet-ready*, not *run a cluster*.
- SQLite challenged too: OLAP-shaped queries favor **DuckDB** (native JSONL ingest,
  better window/aggregate ergonomics); SQLite FTS5 covers the residual search need.
- **Decision: DuckDB ETL → flat denormalized derived tables → Parquet/SQLite serving
  artifacts → React frontend**, with DuckDB-WASM in the browser as a zero-backend
  explorer option for the query-builder ambition.

## 3. Insight brainstorm → 8-lens adversarial fan-out

- First drafted the insight catalog by hand (session outcome, job type, error taxonomy,
  friction time, workload distribution, failure→consequence linkage, unmet-capability
  signals, workflow shapes).
- Then dispatched a **workflow of 8 parallel adversarial subagents**, each with a distinct
  lens (ops time/staffing, session mortality, tool-failure forensics, unmet capability,
  agent behavior, workflow morphology, professional skeptic, auditor/engagement
  portraits), each required to verify claims against the raw JSONL.
- Major verified findings:
  - **Portal-auth wall** — ~207 anchored auth failures across 63 sessions, all 7
    auditors, with a sharp **Mar 29–31 incident spike** (24/42/43 hits/day); the error's
    printed remediation command appears in zero subsequent tool inputs.
  - **Three missing CLIs** — 117 `command not found` outputs, 100% concentrated on three
    commands across 50 sessions: a bounded provisioning fix.
  - **Restart adjacency** — 39 same-auditor sessions starting <1h after the previous.
  - **Machine-injected "user" messages** — ~142 inputs are 15–31KB skill bodies or
    `<task-notification>` blocks, not human asks.
  - **Error-regex/amount collisions** — invented dollar amounts match `403`/`404`
    substrings; only anchored signatures are safe.
  - **Agent-tool output poisoning** — subagent outputs are near-uniform failure
    templates; naive regex sees 299/307 "errors" vs ~51 real.
  - **demo user ≠ tealstone** — the `demo` user works mostly on harborline; tealstone is
    96% imani. Non-billable filtering needs both flags.
  - **Telemetry-dropped turns** — one session starts at turn 22; another is missing
    turns 2–3.
  - Browser automation (all 954 calls) concentrated in 17 sessions, co-occurring with CLI
    auth failures — fallback, not preference; `pdftotext` in 79/116 sessions vs ~140
    total docstore calls.

## 4. Reframe: bipartite observability

- User corrected course: we were sorting *findings* into audience piles; the app needs
  two coherent observability *disciplines* whose categories the findings fall out of.
- **Ops side — the system is the object** (traditional observability): Failures
  (signature-class explorer), Incidents (temporal clustering + blast radius),
  Environment health (per-workstation), Platform reliability (per-surface rates,
  including telemetry integrity itself).
- **Product side — the user and their work is the object** (product analytics):
  Adoption & usage (incl. LLM-classified line-of-business/job-type slicing), Task
  outcomes, Interaction cost, Productivity-vs-wrestling, Capability gaps (the
  feature-request-in-disguise ledger).
- **Crossover:** a directed edge — product-side friction records whose root cause is a
  system failure carry an FK to the ops-side failure/incident entity, with UI deeplinks
  both ways. Shared slice dimensions (client/entity, auditor, job type, date, demo flag)
  power the same filter bar on both sides.

## 5. DERIVATIONS.md — the derived data points

- Wrote `DERIVATIONS.md`: every data point the UI operates on, as **typed fields on
  derived entities** (`tool_event`, `turn`, `session`, failure/incident entities,
  `capability_gap`, shared dimensions), each tagged with a **confidence class**
  (`structural` / `heuristic` / `model`) so provenance is renderable in the UI.
- Included a "known non-derivables" section: per-tool timing, real cost, cross-turn
  amount arithmetic, cross-auditor skill rankings.

## 6. The episode debate — a full reversal

- Initial design merged time-adjacent sessions (same auditor+client, gap of minutes) into
  "episodes" (~116 sessions → ~53), motivated by restart chains and sessions opening with
  closing pleasantries.
- User challenged the justification: time adjacency can't distinguish continuation from
  task-switching; and *causal dependency is not continuation* (editing a file a prior
  session created is a new task).
- Evidence review against the raw data: exactly **one** resumed fragment (turns 22–59)
  with **no predecessor anywhere in the dataset** (telemetry truncation, not linkage);
  **zero** overlapping/duplicate turn numbers (no forks); and the strongest textual
  continuation marker — "thanks — that's what I needed" 1.5 min after a prior session —
  follows a predecessor that ended on a *login failure*, exposing the openers as
  **template noise from the data generator**.
- **Decision: episode entity rejected; the session is the unit of analysis.** Kept:
  `resumed_fragment`/`missing_turns` integrity flags, a **fork detector** as an ingest
  data-quality gate (zero hits today), `quick_restart_after_s` as a workflow-granularity
  fact (explicitly not a linkage), and a new **`auditor_timeline`** entity for
  time/attention metrics (which never needed task identity and must not double-count
  overlapping sessions). If future telemetry carries a real parent-session pointer,
  collapse happens as *data cleanup at ingest*, not analytic overlay.

## 7. ARCHITECTURE.md — the 5-stage pipeline

- Created `ARCHITECTURE.md` with `# DATA ARCHITECTURE` and `# UI ARCHITECTURE` (WIP).
- Proposed a staged, idempotent batch ETL whose boundaries follow the *epistemic class*
  of the data: **RAW** (verbatim JSONL → DuckDB) → **CLEAN** (validation, integrity
  flags, fork gate, identity — zero interpretation) → **DERIVE** (deterministic
  structural/heuristic fields; where unit tests concentrate) → **ENRICH** (LLM
  classification, quarantined in side-tables, structured-output-only, cached by
  input-hash/prompt-version/model; pipeline runs to completion without it) →
  **PUBLISH** (flat facet-ready views emitted as Parquet/SQLite; the UI's only contract).
- Cross-cutting: **rule tables and thresholds as versioned data files**, a **run
  manifest** per execution (input hashes, rule/prompt versions, gate results), and an
  explicit not-built list (no streaming, no incremental ingest, no scheduler).

## 8. Adversarial DERIVE review — deterministic vs "flavor"

- User's suspicion: some DERIVE fields (especially size-based ones) smuggle in semantic
  judgment; anything touching "flavor" belongs in ENRICH. Dispatched an adversarial fork
  to attack every stage-2 field against the actual data.
- Findings applied to `DERIVATIONS.md`:
  - **`origin` enum rejected**: no clean valley in message sizes; 104 marker-bearing
    messages are under 1k chars; all 98 extract-paste turns have a nonempty *typed
    prefix*, so an exclusive typed/pasted enum cannot represent composites. Replaced
    with independent deterministic marker flags (`has_task_notification`,
    `has_skill_body`, `has_extract_paste`) + `typed_prefix_chars`.
  - **Platform-limit marker discovered** — "you have hit your org's monthly spend
    limit" in 40 *assistant* outputs (12 sessions, 6 session-terminal), overturning the
    earlier "no kill markers anywhere" claim (which had swept only tool outputs with the
    wrong keywords). The marker is deterministic; attributing session death to it is not
    (one session carries it in turns 1–7 and runs to turn 70).
  - **`ended_mid_work` demoted to model** — refuted by data: most tool-heavy final turns
    end with completed work.
  - **Recovery labels demoted** — stage 2 keeps only the neutral `post_failure_shape`
    (514 same-tool-clean-later / 179 other-calls-after / 77 turn-ends-on-failure);
    `self_recovered`/`fatal` are semantic claims.
  - **Counts-vs-labels principle**: stage 2 emits `max_same_tool_run` and
    identical-input-chain counts; "grind"/"thrash" labels are interpretation.
  - New **`curated`** confidence class for human-authored taxonomy applied mechanically
    (signature classes, `counts_as_failure` per signature — e.g. `exit 1` on
    `AskUserQuestion` is plausibly a user declining, not an error).
  - Boundary principle written into the doc: *stage 2 computes facts and parameterized
    arithmetic; the moment a field's name asserts intent, effort, success, or
    failure-as-experienced, it is model-class.* Candidate-generator flags (e.g.
    `short_typed_after_short_gap`) let ENRICH classify 92 turns instead of 763.

## 9. UI concept proposal → parked in UI_PLAN.md

- The UI-concept subagent returned a full design: **a findings brief with two rooms
  behind it** — the app lands on ≤8 ranked, threshold-generated finding cards (the
  README's "five insights beat forty numbers" made literal), deeplinking into two
  visually distinct sides (Ops: slate/red, "is the system healthy?"; Product:
  indigo/green, "are people getting work done?"), every path terminating in a
  session-transcript viewer ("prove it").
- Honesty as first-class UI: **provenance chips** (`S`/`H`/`C`/`M`) on every metric,
  evidence popovers on every heuristic/model value, stated-parameter ⚙ popovers,
  undetermined as a color in every legend, and **disabled ghost cards** at the exact
  spots users would look for forbidden views (cost, tool latency) — taste about what not
  to build, made visible.
- Its own cut list: the DuckDB-WASM query explorer (our earlier darling —
  infrastructure-over-insight within the timebox), auditor rankings, prose mining,
  real-time anything.
- Reconciled with the DERIVE review while writing it up (post-failure-shape micro-bar
  replaces recovery labels; non-exclusive marker badges replace origin icons).
- **Decision: parked in `UI_PLAN.md` as a draft for later discussion** rather than
  merged into `ARCHITECTURE.md`. This `PROGRESS_LOG.md` was created at the same point.

## 10. Adversarial UI review — the discovery test

- Dispatched a fork to attack `UI_PLAN.md` against README/data: coverage mapping both
  ways, a "can you discover something we didn't pre-bake?" test, and presentation audit
  at real cardinalities.
- **Verdict: as drafted, the UI re-views what we already found — excellently — but
  fails the discovery test.** Evidence:
  - The **extract-paste workflow grew ~10×** (1–7/day early month → 17/day Mar 30–31) —
    the most interesting trend in the set, and *undiscoverable* in any planned view
    (capability-gap ledger was static counts).
  - **Working rhythm** — a verbatim README example question — had no construct anywhere;
    the whole `auditor_timeline` axis was orphaned.
  - **Agent behavior** ("where the agent needs better instructions" — verbatim audience
    concern) had no surface; chains/corrections/grind counts were homeless.
- Presentation fixes ordered: **stacked bars, not area** (area interpolation fakes a
  week-long ramp out of quillbrook's 2-day burst), **run-length-compressed tool strips**
  (real turns hit 131 tool calls; compression also *is* the grind visualization),
  chip diet (only `H`/`C`/`M`; unchipped = structural), determined-share caption on
  outcome bars, and a **degradation spec for finding cards** (the doc-location
  concentration card silently vanishes without enrichment).
- Applied immediately: two new routes in `UI_PLAN.md` — **`/ops/rhythm`** and
  **`/product/agent`**. Remaining fixes parked for the UI discussion.

## 11. Failure complexity → the six-stage pipeline

- Returning to data architecture, the user pressed: do we need LLM enrichment *before*
  we can decide whether a tool call failed? Is something inherently missing?
- Analysis: failure **detection** stays deterministic — the generated text makes failure
  phrasings a *finite, enumerable* template set, so the anchored rule table isn't
  approximating an open language problem; and the genuinely opaque cases (uniform
  subagent error strings) yield nothing to an LLM either.
- But the question exposed a real structural flaw: **aggregation was conflated with
  derivation.** Failure aggregates (signatures, incidents, terminal rates) were computed
  in stage 2, *upstream* of enrichment — so model verdicts could never reach the numbers
  the UI displays.
- **Decision: restructure to six stages** — RAW → CLEAN → DERIVE (row-level facts only)
  → ENRICH → **AGGREGATE** (moved after enrichment) → PUBLISH. Aggregates compute over a
  **merged `failure_verdict`** (`rule | model_added | model_cleared | uncertain | none`)
  so every count exposes its provenance split; graceful degradation preserved (without
  enrichment, aggregate over rule verdicts alone).
- New ENRICH roles this unlocks: per-instance **gray-zone adjudication** (the rule table
  says "uncertain", the model reads turn context), turn-level silent-failure reads, and
  **J5: the LLM as measurement instrument** — seeded samples of matched/unmatched
  outputs estimating the rule table's false-positive/negative rates, giving the UI
  honest **error bars** on every failure count.

## 12. LLM_ARCHITECTURE.md

- Created `LLM_ARCHITECTURE.md`: enrichment is **five independent, resumable jobs** —
  J1 gray-zone failure adjudication (only where rules are explicitly unsure), J2 turn
  classification (friction/cause for all turns; correction only for the 92 flagged
  candidates), J3 session classification (job type, outcome, ended-mid-work; consumes
  J2), J4 capability-gap naming (the model names and groups, never counts), J5 the
  heuristic audit.
- **Context packets embed stage-2 facts as structured JSON** plus deterministically
  truncated text; the model reasons on top of facts, never re-derives structure, and
  can't invent it (e.g. J2's linked signature is validated post-hoc against actual
  matches).
- **Abstention is a first-class output** with the invariant: *every selected record gets
  exactly one row per job — a judgment, an abstention with reason, or an error* — so
  denominators are always exact and "the model couldn't say" is a visible, counted
  slice. An escape-hatch table covers each missing-context case (load-bearing source
  field missing → skip the call, no spend; truncated session heads → judge from the
  tail, never infer; packet overflow → structured elision then abstain; double schema
  failure → error row; job skipped → NULL columns + degraded UI captions).
- Scale envelope: **under ~1,500 requests** for the whole dataset, one-shot, fully
  cached thereafter.

## 13. ETL_ARCHITECTURE.md — then the Bun revision

- Created `ETL_ARCHITECTURE.md`: the concrete offline-prerequisite pipeline.
  **TypeScript end-to-end**; DuckDB (`@duckdb/node-api`) as the processing engine (one
  local `pipeline.duckdb` holding stages 0–4 as schemas); SQLite for serving; Parquet
  exports as the machine-readable deliverable; Zod at every boundary; the OpenAI JS
  client with structured outputs (`baseURL` from env — any compatible endpoint).
- **LLM cache in its own SQLite file** (`llm_cache.sqlite`), keyed
  `sha256(job | packet_hash | prompt_version | model_id)`; it survives full pipeline
  rebuilds and only an explicit `--recache` clears it. Packet builders are pure and
  unit-tested because *packet stability is cache correctness*.
- **Run manifest** (input hashes, rule versions, gate results, enrichment coverage,
  model/prompt ids) embedded into the serving artifact via a `_meta` table.
- Testing concentrates on stage 2 with golden files from the real traps (the
  `82,403,527.00`-must-not-match-403 case is a named test); honest gap noted: enrichment
  *quality* isn't unit-testable — J5 is the monitor.
- **Revision: the user directed Bun** — runtime, package manager, and test runner in one
  toolchain; **`bun:sqlite`** (built-in, native, zero-dependency) replaces
  `better-sqlite3` for both serving artifact and cache; `bun test` replaces vitest;
  DuckDB's N-API binding expected to load under Bun as-is, flagged for verification and
  version-pinning at scaffold time (fallback: DuckDB CLI as subprocess).

## 14. Holistic UI↔ETL congruence review

- Walked every `UI_PLAN.md` construct against the ETL's published outputs. Conceptually
  aligned; **six concrete failures** found and fixed.
- **The load-bearing incongruence: the shared filter bar vs global precomputed
  aggregates.** Every chart promises re-slicing by client/auditor/date/job-type/demo,
  but stage 5 published *global* rollups — useless the moment a filter is applied.
  **Serving contract re-drawn**: fact views carry every filter dimension denormalized —
  including `job_type` *pushed down from sessions onto ops facts* (a deliberate
  cross-half dependency: ops pages filter by a product-side model classification) — and
  the thin API does GROUP BY at request time (6.5k rows in SQLite = microseconds).
  Precomputed views survive only where recomputation is impossible: incident windows
  (bands stay global under filtering — documented caveat), J5 error bars, signature
  metadata, findings.
- The five other gaps, fixed in `ETL_ARCHITECTURE.md` stage 5:
  - **Finding cards had no producer** — analytic logic was silently sliding into React.
    Now `v_findings`, built from versioned threshold rules (`rules/findings.yaml`), each
    row carrying claim params, target-URL params, provenance, and a
    `requires_enrichment` flag — which doubles as the degradation spec the UI review
    demanded.
  - **The session viewer needed text never promised for publication** — `v_turns` now
    carries user/assistant transcripts; `v_tool_events` carries `matched_snippet`.
  - **Deeplink keys must survive re-runs** — signature `pattern_id`s and gap ids come
    from versioned rule files, never per-run sequences.
  - **Crossover chip grain mismatch** — `linked_failure_signature_id` lives on turns but
    the friction table is session-rowed; stage 4 now rolls up
    `dominant_linked_signature` per session, plus a `v_gap_sessions` exemplar bridge.
  - **Abstention states weren't in the serving enums** — `v_sessions.outcome` publishes
    the full five-state enum (`completed | abandoned | undetermined | unclassified |
    NULL`), and `_meta` carries per-job enrichment coverage so pages know when to flip
    degraded captions.

## 15. The time-slice pivot — Parquet to the browser

- User proposed restructuring the backend as a **time-slice deliverer**: Parquet files
  to the frontend, a CloudWatch-style time-window control, browser-cached partitions —
  "in principle, this scales."
- Adopted, with two corrections that became the **two-plane design**:
  - **Fact plane** (turns, tool_events) partitioned by event day — honestly
    time-sliceable, grows linearly, the window determines what the browser ever
    downloads.
  - **Global reference plane** fetched whole (sessions + all precomputed aggregates) —
    sessions span windows (one spans 27 days and belongs to no partition), and
    incidents/error-bars/findings are computed over the full dataset; slicing them
    would silently recompute different answers per view.
- Content-addressed layout: everything under a run id is **immutable** → browser caches
  partitions permanently; cache invalidation is free by construction.
- **This deleted the query API entirely.** The thin-API GROUP-BY contract from §14
  carries over unchanged, one level down: aggregation now runs client-side via
  **DuckDB-WASM — returning as the invisible query engine behind the canned views**,
  explicitly *not* un-cutting the query-builder UI. The Parquet deliverable and the
  app's data source become the same bytes: one contract, no server.

## 16. Window semantics — two exchanges, landing per-side

- First pass: containment ("only sessions that began and ended in the window") accepted
  with amendments — facts must still slice by event timestamp (else the Mar 29–31 spike
  partially vanishes: its heaviest sessions are contained in *no* reasonable window),
  and exclusion must be visible.
- **User's sharper reframing adopted: the membership rule aligns with the sides, not
  the views.**
  - **Ops = pure event-timestamp membership** (CloudWatch semantics). Every ops
    construct is event-grain; sessions are only drill-down links there — nothing is
    excluded.
  - **Product = whole-session containment**, with a visible "N sessions overlap this
    window but aren't fully contained (excluded)" caption (clickable to list them) and
    a documented **edge-censoring caveat** (long sessions vanish near window
    boundaries — a trap we're *introducing*, so it's written down).
  - Mixed-grain pages (`/product/usage`: turns/day timeline vs job-type share) carry
    both rules, each captioned; **crossover deeplinks compose the two** (incident →
    product window set to incident span → containment + caption apply).
- Applied to the ETL stage-5 spec (partition layout documents the semantics it assumes)
  and the UI plan: **first-class header time-window control** (presets + brush,
  URL-encoded), **defaulting to full dataset range** so a one-month static dataset
  never opens on an empty 24h view.

## 17. Infrastructure architecture

- Created `INFRASTRUCTURE_ARCHITECTURE.md` (now `docs/architecture/infrastructure.md`):
  deployment as **a real internal tool with POC stand-ins, where every stand-in
  preserves its production interface** — scaling is a swap of implementations, never a
  redesign.
- **No application server.** Runtime backend = static file delivery (object store + CDN
  in production; one ~30-line `Bun.serve()` locally, kept only to force correct cache
  headers). All compute is offline (ETL) or client-side (DuckDB-WASM). Serving capacity
  is CDN bandwidth; query capacity is the user's machine.
- **`latest.json` is the only mutable object** — publish and rollback are both an
  atomic repoint; retained run directories + manifests double as audit trail and
  pipeline telemetry.
- **Edge SSO with zero-app-change auth-agnosticism**: cookie-based proxy auth
  (oauth2-proxy / Access / IAP), no client secrets, no login UI — the POC ships no
  auth, but the zero-app-changes property is the deliverable.
- **ETL production shape is scheduled-incremental** (Langfuse high-water mark, write
  only new day partitions, rebuild the small reference plane whole, cache makes
  enrichment incremental automatically); the POC's manual full rebuild emits the
  identical layout.
- **Scale table**: day partitioning + window-bounded fetch now; deferred until real
  scale — hour sub-partitioning past a size budget, **`rollups/` multi-resolution
  aggregates for wide windows (CloudWatch's own trick — manifest declares resolutions,
  UI picks by window span)**, `ref/sessions` month-partitioning, provider batch API for
  enrichment.
- **"Presents as REAL" rules**: no demo affordances, manifest-derived (never
  hardcoded) date coverage, first-class empty-window states, per-partition loading
  skeletons, degraded-enrichment captions presenting as the operational states they
  genuinely are.

## 18. Documentation reorganization + CLAUDE.md

- Restructured: `docs/architecture/` (`overview.md`, `derivations.md`, `etl.md`,
  `llm.md`, `infrastructure.md`), `docs/plans/ui.md`, and this log moved to
  `docs/PROGRESS_LOG.md`. Titles renamed (no more `_ARCHITECTURE` suffixes),
  cross-references rewritten to new paths and verified clean by grep. Root `README.md`/
  `DATA.md`/`SCHEMA.md` untouched — read-only challenge spec. (Old filenames in earlier
  sections of this log are accurate history, deliberately unchanged.)
- Created root **`CLAUDE.md`**: what we're building and why (bipartite ops/product with
  the honesty axioms), repository structure guide (including planned `etl/` and `app/`),
  an architecture **BRIEF** — one paragraph per layer with pointers to full specs — and
  working conventions: the adversarial-review method, thresholds/taxonomies as
  versioned data files, and a **do-not-build list** (cost/token views, per-tool
  latency, auditor rankings, cross-turn amounts, prose mining).

## 19. Current state

- **All architecture layers documented end-to-end**: data model
  (`docs/architecture/derivations.md`) → pipeline concept (`overview.md`) → ETL
  (`etl.md`) → LLM enrichment (`llm.md`) → serving + deployment (`etl.md` stage 5,
  `infrastructure.md`) → UI (`docs/plans/ui.md`, still draft).
- **Queued:** the UI plan discussion — rhythm and agent-behavior view specs plus the
  adversarial review's remaining presentation fixes (stacked-bars swap, tool-strip
  run compression, chip diet, determined-share caption).
- **Not yet started:** implementation — `etl/` and `app/` are planned directories only;
  no pipeline scaffold, enrichment prompts, frontend, sample output, or one-page
  findings write-up.

## 20. ETL shell built (handoff phase 1)

- Bun scaffold landed: exact-pinned runtime deps (`@duckdb/node-api@1.5.5-r.4`,
  `zod@4.4.3`, `openai@7.5.0`, `yaml@2.9.0`, `p-limit@7.3.1`), strict tsconfig, Biome
  (`noConsole` enforced everywhere except `etl/lib/log.ts`), `bun test` wiring,
  `typecheck`/`test`/`lint`/`etl` scripts.
- **DuckDB-under-Bun smoke test passes on Windows** (Bun 1.3.14) — the M0 stack risk is
  retired; no CLI-executor fallback needed.
- Full module skeleton per `docs/plans/etl.md` §2: real `cli.ts` arg parsing, real
  `context.ts` (centralized env, rule load + zod validation, run_id, manifest recorder),
  six `Stage` stubs, `s3_enrich/` (runner/client/cache/packets + five `JobSpec` stubs),
  `lib/*`; all stage bodies throw a shared `Unimplemented` error carrying module +
  contract reference. `bun run etl run` exits 1 with a clean typed stage-0 failure.
- Real zod schemas (`etl/schemas/`): rule files, the five enrichment outputs transcribed
  from `docs/architecture/llm.md`, manifest, raw spot-checks. Real rule skeletons
  (`etl/rules/`): 9 provisional signatures across all 7 classes (incl. portal-auth-403,
  AskUserQuestion-exit-1 = uncertain, platform-limit), all 69 real tool names mapped to
  families, thresholds (gap cap 1800s provisional, J5 N=150/M=100 seeded), findings seed.
- 33 SQL files with real header contracts (output table, columns per derivations.md,
  gates) and `-- UNIMPLEMENTED` bodies.
- Contradictions recorded, not silently fixed: (1) "7 families" prose vs 8 enum values —
  kept 8 (derivations.md wins); (2) default-run enrichment vs missing-key startup error —
  resolved as `EnrichmentMode` auto (degrade) vs required (`--stage 3`/`enrich` → fail
  fast); (3) minor layout drift → followed plans/etl.md, added `stages/types.ts` for
  shared `Stage`/`Gate` types.
- Verified independently by the orchestrator: tsc clean, Biome clean, 3/3 tests pass,
  typed stage-0 failure on `etl run`.

## 21. Integration test suite (handoff phase 2) — deliberately red

- **`test/harness.ts` built for real** per `docs/plans/etl_testing.md` §2: per-test temp
  workspaces (kept + path printed on failure), real RunContext with overridable rules,
  fixture staging, real in-process entrypoints (`runPipeline`/`runStage`/`runJob` via
  the production CLI path), `injectResponses` at the client seam (default = the
  no-credentials trap), fault arming, sleep/cache spies, DuckDB/publish/cache state
  probes, non-optional env scrubbing.
- Typed response-script helpers (`valid`/`invalid`/`malformed`/`http`/`timeout`)
  compile-checked against the job zod schemas; script exhaustion throws naming job+call.
- Fixtures checked in with a `fixtures:rebuild` script: 10 golden trap cases pinned to
  real observation ids (incl. `amount_403_must_not_match` on `$69,403,439.86`,
  AskUserQuestion exit-1, platform-limit; one flagged-synthetic 5xx — no real exemplar
  exists), the 5-session slice (resumed-fragment `49d43953`, platform-limit `7ab6b10b`,
  browser-heavy `9b58b0bc`, clean single-turn `327038b2`, abstention `eaec5bef`; 55
  traces / 719 obs) with a 40-entry expectations file (35 verified from raw data, 5
  estimated pending implementation), hand-built fork/referential/timestamp violation
  fixtures.
- All etl_testing.md families written through real entrypoints: stage-level s0–s2,
  gate/abort (exit 2), degraded + enriched full pipeline, publish atomicity with fault
  injection, the complete LLM response matrix (happy branches + full sad-path table +
  batch-grain J2 + exactly-one-row invariant → exit 3), resume/cache, canaries.
- **State: 108 tests — 31 green / 77 red / 0 skipped, ~2.3s.** Every red fails with an
  `Unimplemented` error surfaced through a real entrypoint (grouped and verified); every
  green is smoke/canary/schema/rule/fixture-shape/pure-structural, each justified. This
  red set is the implementation phase's to-do list.
- Seam-only `etl/` touches recorded: injectable clientFactory/sleep/fault on RunContext,
  `runCli` export + `exitCodeForError`, client error contract types, new
  `lib/signatures.ts` seam (Unimplemented), `fixtures:rebuild` script.
- Findings for implementation: `askuserquestion-exit-1` provisional pattern
  (`'exit code 1'`) cannot match the real template (`'(exit 1)'`); `tool-http-5xx` has
  zero real exemplars; stale client.ts comment places backoff in the client while the
  runner owns it; packet overflow covered at unit grain (budget is a frozen constant).
- Orchestrator verified: `bun test` 31/77/0 in ~2.2s, tsc clean, biome clean over
  `etl/`+`test/`+root (a parallel app workstream owns its own lint state).

## 22. App track A0 — contracts, fixture pack, boot spike, palette (milestone gate)

- **`contracts/` is ready for ETL adoption** (the one coordination gate, app.md §8):
  `contracts/src/` holds zod schemas transcribed from derivations.md + etl.md stage 5 —
  shared enums (8 tool families, 7 signature classes, tri-state `counts_as_failure`,
  merged `failure_verdict`, published outcome enum with `unclassified`/NULL semantics),
  one row schema per published table (facts/turns, facts/tool_events, 8 ref tables),
  serve `manifest.json` + `latest.json` shapes (incl. `stated_params` for the ⚙
  affordances), and shared JSON-text-column parse helpers. Convention adopted: nested
  values (series, id lists, target params) publish as JSON-encoded TEXT columns.
- **Fixture pack**: deterministic seeded generator (`contracts/fixtures/generate.ts`,
  `bun run fixtures`) emits `contracts/fixtures/static/runs/{fixture-run-0001,
  fixture-run-degraded}` — 608 turns / 3,041 tool events / 64 sessions / 50 day
  partitions per run, with the worst-case shapes baked in: 76-turn session with a
  131-call browser-grind turn, 46KB pasted message, platform-limit banner session,
  resumed fragment (turns 22+), missing-turns session, 12-day-span outlier, quick-restart
  pair, tealstone demo traffic, Mar 29–31 portal-auth incident spike, and
  undetermined/unclassified outcomes. Degraded variant NULLs all model fields, empties
  enrichment coverage, and keeps only `requires_enrichment=false` findings. Every row
  zod-validates before write; conformance is also a checked-in test
  (`app/test/contracts.test.ts`, 13 tests green).
- **DuckDB-WASM boot spike passes in-browser**: latest.json → manifest (zod-gated) →
  ref plane + windowed partition registration → SQL over the fact view returns correct
  counts (594 turns = 608 minus demo, demo excluded by default). One dev-only trap fixed:
  Vite's dev transform breaks the classic DuckDB worker script — imported via `?worker`
  with the eh bundle pinned.
- **Palette finalized via the dataviz validator**; report checked in at
  `app/PALETTE_REPORT.md`, tokens in `app/src/theme.css` (7-slot categorical
  theme, slate sequential ramp, reserved failure brick, chip colors — no purple).
- Root changes were additive only: `workspaces` in package.json, biome includes.

## 23. Readiness review (handoff phase 3)

Adversarial review by a fresh agent (not the phase-1/2 authors): three parallel audits
(doc↔shell congruence, test↔spec congruence, fixture integrity) plus direct toolchain
verification. Question answered: is the shell + red suite safe to hand to
implementation-level developers?

**What exists / verified:**
- Full `etl/` skeleton per plans/etl.md §2: all modules present with correct
  responsibilities and dependency direction; five SQL stages export `Stage` objects whose
  SQL-file and gate lists match disk and etl.md; 33 SQL files with real header contracts
  and bodies exactly `-- UNIMPLEMENTED`; s2/s4/s5 headers checked field-by-field against
  derivations.md — clean (one gap, below); all 4 rule YAML files zod-validate through the
  real `loadRules()`, 9 signatures carry the curated fields, 69 tool names mapped.
- No rejected patterns anywhere: no episode merging, no exclusive origin enum (three
  marker flags + typed_prefix_chars, with an explicit note), no stored semantic recovery
  labels, s4 consumes `enrich.*` downstream of stage 3, no cost/token/latency/ranking
  views. No pipeline logic in stage bodies/runner/cache/signatures — all throw the shared
  `Unimplemented`; only allowed trivia (hash, log, arg-parse, YAML load, DuckDB plumbing)
  is real. No manifest/published-table schema authored in `etl/schemas/` (contracts/
  boundary respected).
- All etl_testing.md §3–§5 families present and running; §4 response-matrix complete
  including batch-grain J2 double-invalid and both zero-client-call cases (overflow at
  unit grain only — already recorded in §21). Canaries are real: env scrub is
  non-optional and canary (a) drives the real `runJob`→`OpenAiClient` construction,
  which throws `MissingCredentialsError` on an empty key with no default endpoint — a
  later env fallback in client.ts would flip it red. No `test.skip`/`test.todo`/`.only`
  anywhere in `etl/` or `test/`.
- Fixture integrity confirmed against the raw data: all 9 non-synthetic golden trap
  cases byte-match their pinned observation/trace ids (incl. `amount_403_must_not_match`
  — `$69,403,439.86` present, no "HTTP 403"); the single synthetic case is flagged; the
  5-session slice ids all exist with claimed properties (resumed fragment `49d43953…`
  recomputed: turns 22–59, min turn 22 > 1; `9b58b0bc` 88% browser obs); all 44
  expectations recomputed from raw — every "verified" value matches (the 5 "estimated"
  signature counts also reproduce); slice/staged JSONL lines are byte-identical to
  `data/*.jsonl`.

**Red/green tally observed:** `bun test ./test` = **31 pass / 77 fail / 0 skip, 108
tests, ~2.2s** — exactly the §21 claim. (Bare `bun test` reports 44 pass because it also
picks up 13 green out-of-scope `app/test/` tests.) Each of the 31 greens individually
verified legitimately structural (arg parsing ×5, DuckDB smoke, fixture-shape ×9,
canary/harness ×5, rules ×2, schemas ×6, exit-code mapping, packet-constant, unknown-job
rejection); none vacuous. Red sample across all families: every red fails through
`expectReal`/`expectJobReal` with the pipeline's own `Unimplemented` carrying the correct
contract reference — zero harness bugs.

**Toolchain reality:** `bun install` no-op against the lockfile; `bunx tsc --noEmit`
clean; Biome clean over `etl test *.json`; the five runtime deps exact-pinned (no
`^`/`~`); DuckDB smoke passes; `bun test` exits 1 while red; `bun run etl run` exits 1
with the typed stage-0 `Unimplemented` via the structured logger.

**Findings (recorded, not patched):**
- minor — `etl/schemas/enrichment.ts`: `InsufficientReasonSchema` adds two enum branches
  not in llm.md (`unreadable_context`, `other`), and `J1OutputSchema.reason` is
  `.nullable()` where llm.md shows a plain enum. Defensible (abstention rows), but
  undocumented deviations from "transcribed exactly". Proposed resolution: amend llm.md
  or shrink the schema — decide explicitly at implementation start.
- minor — derivations.md §7 field `description` (J4 display text) has no column home in
  `s4_capability_gaps.sql` / `s5_ref_capability_gaps.sql` (only `display_name`); it
  exists only in `J4OutputSchema`. The single field-home gap found.
- minor — §20 says "six `Stage` stubs"; only five `Stage` objects exist — s3_enrich is a
  JobSpec registry (correct per etl.md, but plans/etl.md §2's "each exporting a Stage"
  is literally unmet for s3; unrecorded contradiction). Proposed resolution: annotate
  plans/etl.md §2, don't force a Stage wrapper.
- minor — `test/harness_canary.test.ts` canary (b) pokes `ScriptedClient` directly
  rather than through `runJob` as §5 words it, and asserts job+call number, not
  job+record id. Trap still real.
- minor — the 39 enrich-family reds all die at the first gate (`LlmCache.open`);
  downstream assertions are unexecuted until gates lift — expected, but implementers
  should expect progressive re-reddening.
- nit — `test/harness.ts` `runJob` builds `trapEnv` manually with
  `enrichmentMode:"off"`; a future env-resolution fallback in `context.ts` (not
  client.ts) would bypass canary (a)'s construction path.
- nit — stale backoff-ownership comment in `s3_enrich/client.ts` vs runner.ts (already
  recorded in §21, still unresolved).
- nit — `s3_enrich/index.ts` (trivial job registry) is not in the plans §2 layout and
  not covered by §20's layout-drift note.
- nit — synthetic fork-violation fixtures reuse the real client name "harborline"
  (fake-domain email, no id collisions; cosmetic).
- doc nit — PROGRESS_LOG has two sections numbered "## 21" (test suite; app track A0) —
  renumber on next edit.

**Contradiction verification:** §20's three recorded contradictions check out — (1) the
8-value family enum is the implemented state everywhere, though the "7 families" prose
could no longer be located in current docs (likely edited since; resolution remains
correct); (2) `EnrichmentMode` auto/required behavior implemented exactly as recorded;
(3) `stages/types.ts` drift accurate. §21's recorded findings (askuserquestion-exit-1
pattern can't match `'(exit 1)'`, no real 5xx exemplar, stale client comment, overflow
unit-grain) all verified accurate against the code. New contradiction added above (s3
Stage export).

**Verdict: GO** for implementation-level development. No blocker or major findings;
the shell is congruent with the specs, the red suite is honest and points at the right
contracts, fixtures are faithful to the raw data. Conditions: (a) resolve the
enrichment-schema deviations vs llm.md explicitly before implementing stage 3; (b) give
derivations.md §7 `description` a declared column home (or record its intentional
omission); (c) fix the stale client.ts backoff comment when touching that file; (d) run
the ETL suite as `bun test ./test` (or filter) when asserting the 31/77 split, since the
app workspace adds greens.

## 24. Mid-flight spec alignment (cross-doc review from the architecture session)

- The architecture session amended `docs/_HANDOFF.md`, `docs/architecture/etl.md`, and
  `docs/architecture/derivations.md` while phases 2–3 ran. ETL-track alignment applied:
- **Manifest ownership boundary**: `etl/schemas/manifest.ts` renamed to
  `etl/schemas/run_manifest.ts` and its header now states it is INTERNAL run telemetry
  only — the published serving `manifest.json`/`latest.json` schemas are owned by
  `contracts/src/manifest.ts` (app track) and adopted by stage 5 at M2. No serving or
  published-row schema remains authored under `etl/schemas/`.
- **Hive-style partitions**: all fact-plane path references switched from
  `facts/<table>/<day>.parquet` to `facts/<table>/day=<date>.parquet` (s5 module + SQL
  headers, pipeline/atomicity tests, fixture rebuild comment).
- Verified no conflicts with the other derivations.md fixes: no `turn_origin` anywhere
  in etl/test; `gap_id` already curated/stable in the s4/s5 headers; `s5_ref_sessions`
  already carries the five-state publish outcome enum.
- Re-verified after alignment: tsc clean, biome clean (etl+test), `bun test ./test`
  still exactly 31 pass / 77 fail / 0 skip. The phase-3 GO stands.

## 22. App track A1 + A2 — shell and session viewer

- **A1 (shell)**: nav rail with ops/product identities; CloudWatch-style window control
  (presets clamp to manifest coverage, default = full range, manifest-derived); shared
  filter bar (client→entity cascade, auditor, M-chipped job multi-select, demo toggle
  default-off); URL codec byte-stable (tested); loader: latest.json → zod-gated manifest
  → ref plane, window-scoped partition fetch with in-session registry + per-partition
  progress, windowed queries serialized on one chain so view swaps can't race; empty
  window renders first-class zero states; malformed manifest renders an error state;
  degraded run (`?run=fixture-run-degraded`) boots with the enrichment-partial footer.
- **A2 (session viewer)**: verified against the worst fixtures — 76-turn session, the
  131-call turn compressed to run-length blocks (×91 badge), 46KB message collapsed
  with size label, platform-limit banner, resumed-fragment (turns 22+) and
  missing-turns chips, marker badges (non-exclusive), typed-prefix size badge, log-scaled
  gap spacers (>2h distinct), evidence popovers on job/outcome chips and on tool blocks
  (rule id + verbatim matched snippet), red ring = counts-as-failure / grey ring =
  uncertain. Tool-family colors are a deliberate fixed binding (brick → subagent so
  browser-heavy strips don't read as failure walls); documented in series.ts.
- Cross-session doc amendments (ownership, hive partitions, 5-state outcome, curated
  gap_id, MDD four-route core) reviewed: contracts already conform; build order
  reprioritized to `/` + `/ops` + `/product/outcomes` + `/session/:id` first.
- Corroborating read-only review from the orchestration session (post-GO), two notes
  for implementation: (1) `portal-auth-403`'s line-start alternation
  (`(?:^|\n)\s*(?:HTTP\s*)?403\b`) can false-positive on a line-leading amount like
  `403,527.00` — keep the amount-collision golden case aimed at that alternation when
  patterns are tuned; (2) `ManifestRecorder`'s accumulation is real (an intentional
  infrastructure exception, like hash/log/arg-parsing) — its green schema test is
  explained, not suspicious. Also: root `bun test` mixes in app-track greens; per-track
  tallies use `bun test ./test` (ETL) — the 31/77/0 figure is ETL-scoped.

## 25. Orchestration: systemic review, README alignment, cross-track supervision

*(Appended by the orchestration session. Note: the file now contains two sections
numbered 22 — §22 "App track A0" and a later app-track entry "App track A1 + A2" also
headed 22; left as-is to avoid restructuring under concurrent writers.)*

- **Systemic architecture review** (two read-only forks: cross-doc contradiction hunt +
  README product-alignment grading):
  - **BLOCKER fixed — manifest-schema double ownership** between the two handoffs:
    `etl/schemas/` is now internal-only; `contracts/` owns all serving schemas
    (published manifest, `latest.json`, published-row shapes).
  - Serving-layout drift in `architecture/etl.md` fixed: **Parquet is the serving
    artifact** (SQLite = cache + optional inspection), hive `day=<date>` partition
    naming, `latest.json` added to the layout, infrastructure.md's layout declared the
    interface.
  - `derivations.md` fixes: 5-state publish outcome mapping documented; **`gap_id`
    split — curated stable key vs model `display_name`**; leftover `turn_origin`
    dimension replaced with marker-flag facets; stale WIP banners cleared in
    `overview.md`.
- **README alignment** (grading pass against the challenge README):
  - **`FINDINGS.md` created** — the one-page deliverable, drafted now from
    hand-verified numbers rather than waiting on the pipeline.
  - **`RUNNING.md` created** — evaluator run instructions + reading order.
  - `ui.md`: who-reads-what persona paragraph (finding-card audience tags = README
    personas OPERATIONS/PRODUCT, cross-cutting our system/user rooms); **request-
    recurrence table** added to `/product/usage` (the last README example question
    without a home).
  - **MDD priority sections added to both handoffs**: ETL — enrichment droppable,
    degraded Parquet + committed sample run is the floor; app — four-route core
    (`/`, `/ops`, `/product/outcomes`, `/session/:id`) beats route completeness,
    droppable tail named (ghost-stub pages if cut).
- **Cross-track supervision** (both build agents running in parallel sessions):
  - Both agents notified of the mid-flight amendments via cross-session messages.
  - ETL agent (session e1) resolved the ownership boundary by renaming its internal
    run-manifest schema to `etl/schemas/run_manifest.ts` — **approved**: internal run
    telemetry is ETL-owned; serving manifest stays contracts-owned. Reported **ETL
    handoff complete** (shell + 108-test suite, 31 green / 77 Unimplemented-red / 0
    skipped, phase-3 GO).
  - Independent read-only review **corroborated the GO** — no violations; two nits
    carried into implementation: the portal-auth-403 line-start alternation can
    false-positive on line-leading amounts; `ManifestRecorder`'s green is an
    intentional, documented infrastructure exception.
  - App-track review (session 81, mid-loop ~A1/A2): **strongly on-track** — contracts
    match the amended serving spec, fully token-based theme with the palette validator
    run, window semantics centralized. Three asks sent: render-smoke tests to complete
    the A1 gate; move `palette-report.md` out of `docs/plans/` and fix the stale
    "mirrors etl/schemas/manifest.ts" comment in contracts; render audience labels as
    README personas.
- All sessions moved to **bypass permissions** to unblock cross-session messaging.
  A cross-track fixture/consistency review (fixture compatibility, duplicated work,
  M2-flip breakage) is in flight; results will be logged when complete.

### §25 addendum — cross-track consistency review results

- Verdict: **tracks converging, not drifting.** App agent's earlier asks confirmed done
  (render-smoke tests, palette report moved into `app/`, stale contracts comment fixed);
  no file touched by both tracks; app imports all enums from `@trace-insights/contracts`.
- Fixture sets confirmed compatible by design (ETL: raw-JSONL slices feeding the
  pipeline; app: synthetic serving-layer run tree) — no collision.
- **Two breakage-grade seam items found** (would fail contract validation at the M2
  flip): `thresholds.yaml` missing two of the six `StatedParams` keys, and
  `counts_as_failure` boolean-vs-string enum mismatch requiring an explicit map at
  publish. Plus: implicit publish-time renames (`timestamp`→`ts`,
  `repeat_of`→`repeat_of_seq_index`, derived `day`) to be named in s5 SQL headers;
  `rule_versions` = YAML version strings (hashes stay internal); duplicate
  JobType/SignatureClass enums to be deleted at M2 adoption; `job_type_secondary`
  added to the contracts sessions row. Corrections dispatched to both agents.
- Infra track opened: an agent is authoring `docs/plans/infra.md` +
  `docs/_HANDOFF_INFRA.md` (Pulumi/AWS, minimal serverless: S3+CloudFront, local/prod
  parity contract).

## 26. Infra track created (plan + handoff)

- **`docs/plans/infra.md` written** — AWS deployment via Pulumi (TypeScript), maximally
  minimal/serverless per `infrastructure.md`'s no-app-server principle: **one private
  S3 bucket (SPA build + `runs/` data tree) + CloudFront with OAC** — no Lambda, no
  containers, no load balancers (candidate functions considered and rejected; SPA
  fallback is a static custom-error response). Cache-behavior/header table is the
  parity-critical contract (`immutable` for `runs/<run_id>/**` and hashed assets,
  `no-cache` for `runs/latest.json` and `index.html`); publish keeps the local
  atomicity ordering (upload run → swap `latest.json` last → invalidate only the two
  mutable objects). ETL keeps running locally/CI; a scheduled runner is specced as
  next-step, not built. Pulumi: `infra/` as own workspace (deps outside the etl/app
  budgets), **local file state backend** (tradeoff documented), `dev`/`prod` stacks,
  config schema `region`/`domain?`/`authMode?`/`prune?`; auth ships `none`/unlisted
  with `sso` reserved — the zero-app-change property preserved.
- **Local/prod parity contract**: local serving (Vite `publicDir` →
  `contracts/fixtures/static`, loader booting `${baseUrl}/latest.json` — already live
  in the repo) must match the deployed interface byte-for-byte in behavior; a
  six-item curl-able parity checklist (headers, SPA fallback vs real 404 under
  `/runs/`, latest.json no-cache, no silent run overwrites) is the verification
  artifact.
- **`docs/_HANDOFF_INFRA.md` written** — goal-loop handoff mirroring the ETL/app
  handoffs: ownership = `infra/**` + additive root wiring only; phases **I0**
  (scaffold + file backend + clean preview) → **I1** (stack up, idempotent, hello
  artifact over HTTPS) → **I2** (deploy scripts + parity checklist passing locally
  AND deployed; RUNNING.md gains a Deploy section) → **I3** (M2-flip rehearsal:
  publish the fixture runs + SPA, verify identical behavior, degraded variant
  included). Escalation: credentials/region are stop-and-ask; no new AWS services
  without sign-off; only fixture runs deploy until the user says otherwise. MDD:
  I0–I2 floor, I3 goal.
- CLAUDE.md structure block updated with both files.

## 23. App track — MDD four-route core complete (/, /ops, /product/outcomes, /session/:id)

- **/ops (A3)**: failure time series (stacked by signature_class, fixed slots, incident
  bands clickable), incident side panel (blast radius, member signatures,
  M-chipped linked friction cost, "see the work this cost →" crossover setting the
  product window to the incident span), signature table (windowed event/session/auditor
  counts from facts + curated metadata, terminal-rate bar, post-failure-shape micro-bar,
  J5 error-bar chips, uncertain-class marker, group-by none/client/auditor pivot,
  row expansion with daily sparkline + verbatim matched outputs + rule id + affected
  sessions), Agent-tool toggle (default off, poisoning tooltip). Deeplink
  `?signature=…` highlights and auto-expands.
- **/product/outcomes (A4 core)**: outcome bars per job type with hatched first-class
  undetermined, distinct unclassified and NULL slices, "N of M determined" caption and
  completion-rate-among-determined headline; interaction-cost strip plot (dot →
  session); friction table with J2 evidence popovers and ↗-to-Ops crossover chips;
  capability-gap ledger (J4 names with degraded fallback to gap_id, evidence-pattern
  popovers, sessions/day sparklines, exemplar links); excluded-sessions caption +
  clickable list; ghost cards (cost, duration league table).
- **/ (A5 core)**: ranked finding cards from ref/findings (audience rendered as
  OPERATIONS/PRODUCT personas, provenance chips, sparkline or metric, "open →" with
  filters pre-set from rule-emitted target_params); degraded-run caption; ghost cards
  (cost analysis, tool latency). Demo-only filter bar on `/` per ui.md §7.
- Fixture improvement: signature matches now insert mid-turn so post_failure_shape
  distributions have a realistic mix (was: everything turn-terminal).
- Cross-track adoption: `job_type_secondary` added to SessionRowSchema + fixtures on
  the orchestrator's decision; scoped `test:etl`/`test:app` scripts at root.
- **Cross-track note**: ui.md's telemetry-integrity strip lists "generation rows
  missing usage" — the serving contract has no per-row usage-integrity field (it lives
  in the pipeline manifest). /ops/environments will show the contract-supported
  integrity signals (resumed fragments, missing turns) and this is flagged rather than
  a column invented in contracts/.

## 27. Infra track — I0 scaffold complete, deploy scripts pre-built (login-gated)

- `infra/` workspace landed per plan §5: own `package.json` (Pulumi + AWS SDK deps,
  outside etl/app budgets), `Pulumi.yaml` (nodejs runtime, bun packagemanager),
  `index.ts` implementing exactly the §1 table — private versioned bucket + PAB, OAC,
  distribution (CachingOptimized default; CachingDisabled behaviors for
  `runs/latest.json` and `index.html`; SPA custom-error fallback; HTTPS redirect;
  PriceClass_100), bucket policy scoped to the distribution ARN, and a least-privilege
  deploy **policy only** (Put/Delete/List + CreateInvalidation) — no users or keys
  created, the operator attaches it. Outputs: bucketName, distributionId/Domain,
  deployPolicyArn, siteUrl. `domain`/reserved `authMode` values error explicitly.
- Local file backend live: `pulumi login file://…/infra/.pulumi` (gitignored), empty
  passphrase provider documented in `infra/README.md` (config holds no secrets;
  hardening path noted). `dev` + `prod` stacks initialized with the §5 config schema.
- I2 scripts pre-built ahead of the stack: `infra/scripts/deploy-data.ts` (manifest
  cross-check → immutable upload → remote count verify → swap `latest.json` last →
  invalidate only that path; parity-item-6 no-op/refuse on existing run id; `--prune`
  gated), `deploy-app.ts` (vite build; excludes `dist/runs/**` — the data plane
  belongs to deploy:data; `index.html` last; invalidates only `/index.html`),
  `parity-check.ts` (checklist §4 items 1–5 automated, item 6 noted as a
  deploy-script property), `serve-local.ts` (prod-shaped Bun server: same header
  table, real 404 under /runs/). Root wiring additive: `infra` workspace +
  `deploy:data` / `deploy:app` / `parity` / `serve:prod-local` scripts;
  `.gitignore` + biome `noConsole` override extended (mirrors etl/lib/log.ts).
- Verification: `tsc -p infra` and `biome check infra` clean. `pulumi preview` on dev
  executes the program (1 to create) and stops **only** at "Failed to refresh cached
  SSO credentials" — the intended login boundary; preview-clean to be re-evidenced at
  I1 after `aws login`. Toolchain note: Pulumi's vendored ts-node breaks on the
  repo's TypeScript 7 preview; fixed per plan §5 ("don't fight the toolchain") with
  local `ts-node` + TS5 devDeps inside `infra/` only.
- **Spec conflict reported (plan §1 vs parity item 5)**: CloudFront custom-error
  responses are distribution-wide, so a missing object under `/runs/` returns the SPA
  shell, not a real 404 — item 5 will pass locally and fail deployed. The
  no-Lambda-class fix is a ~10-line viewer-request CloudFront Function, which the
  deliberately-not-built list forbids without user sign-off. Built per §1 as written;
  awaiting a decision (accept deviation vs sanction the function).
- Next (blocked on `aws login` + account/region confirmation): I1 `pulumi up` +
  hello artifact + idempotency proof, then I2 parity evidence and the RUNNING.md
  Deploy section.

## 28. ETL M1 — stages s0–s2 implemented (implementation phase begun)

- User green-lit implementation; orchestrated per milestone with independent
  verification (this section = M1).
- Built: generic Stage executor in `cli.ts` (pre-gates → drop-and-rebuild schema →
  prepare hook → SQL files → post-gates → manifest entry; manifest finalized in
  `finally`; exit 2 on gate failure); `SET VARIABLE` + UTC session setup keeps `.sql`
  files static; `compileSignatures`/`matchSignatures` in JS RegExp (patterns need
  lookahead guards RE2 lacks); s0 zod spot-check gate; s1 referential + fork gates;
  s2 `prepare()` with the two sanctioned TS row passes (signature matching →
  `_sig_matches`, marker/typed-prefix scan → `_turn_marks`); real SQL for all seven
  s0–s2 files (`clean.observations` gained `output_text`, `obs_index`).
- Rule files bumped sig-v1/thr-v1: `askuserquestion-exit-1` fixed to `\(exit 1\)`
  (readiness item — old wording never occurs) + new curated `tool_scope`;
  `portal-auth-403` gained `(?![,.]\d)` amount guards (peer-flagged risk; the
  amount-collision golden case pins the alternation); `agent-generic-error` scoped to
  Agent incl. JSON-list form; `platform-limit` routed to assistant-output markers via
  new `target` field; thresholds added verbatim marker templates (113/115/98 hits ==
  derivations.md), correction-candidate params (80 chars/120s → 94 candidates vs the
  doc's ~92), `fork_lockstep_threshold_s`.
- **Fork gate redefined (judgment call, documented in thresholds.yaml)**: the naive
  range+window overlap predicate fires 40× on real data (concurrent same-auditor
  sessions are real); redefined as duplicated-stream lockstep (non-demo sessions
  sharing ≥2 turn numbers, each within 600s) — fires on the synthetic fixture, zero on
  the real dataset (demo-user scripted bursts excluded per `is_demo_traffic`).
- Real-data drift note: `post_failure_shape` distribution 484/67/49 vs derivations.md's
  provisional 514/179/77 — expected from first-match-only + tool scoping.
- Verified by orchestrator: `bun test ./test` **57 pass / 51 fail** (was 31/77; all
  remaining reds are s3/s4/s5 `Unimplemented` scope), `tsc --noEmit` and biome clean;
  real-dataset `etl run --no-enrich` completes s0→s2 (8,845 raw rows; 6,556 tool
  events, 763 turns, 116 sessions) and stops typed at s4. No test files modified.

## 24. App track A0–A5 COMPLETE — stopping for review

- Tail routes landed: **/ops/environments** (client × class heatmap, per-100-calls
  normalization, slate sequential ramp, dotted small-n cells at the ⚙ threshold, cell
  click → /ops filtered; telemetry-integrity strip limited to contract-supported
  signals with the manifest-side ones footnoted), **/ops/rhythm** (activity strips with
  hatched demo cells, bout profiles, log-log wall-vs-engaged scatter with dot→session,
  quick-restart strip with the not-a-continuation caption; gap cap as ⚙ on every
  construct), **/product/usage** (job share + concentration callout, stacked-bars LOB
  timeline with the bars-not-area footnote, unranked auditor × client dot grid with the
  confounding footnote, capability-adoption strip with per-family sparklines),
  **/product/agent** (repeat-chain and long-run tables with neutral wording and ⚙
  threshold, correction feed with previous-assistant-tail popovers and degraded caption,
  post-failure shape by family).
- A5 crossover polish: findings "open →" URLs verified to land with filters pre-set;
  `?gap=` highlights the ledger row; incident → product and friction → ops chips walk
  end-to-end (findings → room → session viewer verified by driving headless Edge).
- **Gate status**: A0 ✓ A1 ✓ A2 ✓ A3 ✓ A4 ✓ A5 ✓. app+root typecheck clean, biome
  clean repo-wide, `bun run test:app` 25/25 (render smoke over every route incl. worst
  fixtures + degraded run, URL codec round-trip, contract conformance), `vite build`
  succeeds. Visual double-check via ui-visual-review skipped: no GEMINI_API_KEY in this
  environment; primary verification was screenshot eyeballing of every page (incl.
  empty-window, degraded, deeplink states).
- Remaining out-of-loop (per handoff): the M2 flip (point loader base URL at ETL
  output) and A6 enriched-mode pass — both depend on the ETL track.
- test:etl currently reports failures — those are the ETL track's own red/green suite
  (unimplemented stages), not app-track breakage.

## 29. ETL M2 — s4 aggregate + s5 publish (degraded mode), seam items landed

- Newly green: all pipeline_degraded tests + publish_atomicity (fault after partition
  writes leaves latest.json on the prior run; re-run recovers). Verified by
  orchestrator: `bun test ./test` **62 pass / 46 fail** (all remaining reds are
  stage-3 enrichment scope), tsc + biome clean. No test files modified.
- All five cross-track seam items landed: six `stated_params` keys
  (`small_n_call_threshold: 5`, `grind_run_threshold: 20` added);
  `counts_as_failure` published as string enum (mapped at stage-2 rule injection);
  explicit publish renames (`timestamp`→`ts`, `repeat_of`→`repeat_of_seq_index`,
  derived `day`); serving manifest carries `rule_versions` (YAML version strings);
  contracts adopted — local duplicate enums deleted, every published row validated
  against @trace-insights/contracts row schemas, manifest built to ServeManifestSchema.
- **Open conflict (flagged to orchestration session)**: the degraded-publish test +
  etl.md ("embeds the same content") make the published manifest.json carry the
  internal sha256 `rule_hashes` alongside `rule_versions`; if seam item 4 intended
  hashes absent from serving, test/etl.md vs the seam note disagree — followed
  test/etl.md.
- capability_gap `description` has its column home (agg + ref, NULL degraded); gap
  clusters versioned in findings.yaml (`shell-pdf-pipeline` deliberately absent —
  needs tool input text derive does not carry; M4 note). `matched_snippet` computed in
  stage 2. Stage contract gained `finalize()` (s5 export/pointer swap); `enrich.*`
  guaranteed-empty-if-absent keeps s4/s5 SQL statically NULL-tolerant.
- Real-dataset publish: 116 sessions, 763 turn rows, 48 partitions / 24 days; top
  signatures cli-command-not-found 117, missing-file 113, portal-auth-403 106 (42
  sessions); 7 incidents all inside the predicted Mar 29–31 window; both degraded
  findings cards publish; outcomes all NULL. Committed sample run at `sample-output/`
  (58 files, ~1.0 MB).
- Judgment calls: incident baseline = events per active-span-day with ≥3-event small-n
  guard; findings claim gates implement min_sessions/min_auditors generically; only
  `metric: event_count` computable at M2; platform-limit shows 0 tool-event count in
  ref/failure_signatures (assistant-output marker, not a tool event) — future UI
  caption.
- §29 manifest conflict adjudicated (orchestration session): superset resolution
  approved — rule_versions is the UI-facing display field, hashes stay embedded in
  serving (strengthens manifest-chain traceability; contracts zod ignores unknown
  fields). No doc/test change. Commits are owned by the orchestration session; ETL
  track does not commit/push.

## 25. App track A6-nav — navigation revision + dashboard landing (user directive)

- **Navigation shell** per the new ui.md §3 subsection: horizontal navbar (Dashboard ·
  Ops · Product); room sub-pages render as horizontal tabs inside the room (Ops:
  Failures · Environments · Rhythm; Product: Usage · Outcomes · Agent), active tab
  underlined in the room identity color, active room entry tinted with its soft token.
  The shared filter bar sits below the navbar and persists across tab switches — tabs
  are the existing routes and the URL codec is unchanged (search params carried through
  every nav/tab link). The provenance legend moved into the navbar's right edge.
- **`/` is now a dashboard**, three zones: (1) the ranked finding cards (unchanged);
  (2) compact top-level visuals — failure time series with incident bands (band click
  now always lands on /ops with the panel open), job-type share, daily-activity strip —
  each the same component as its room version (FailureTimeSeries shared as-is;
  JobShareBar and ActivityStrips extracted from their pages into shared components with
  a `compact` prop), title click-through to the owning tab with filters preserved;
  (3) a category-card grid — one card per sub-page with room-colored top accent, the
  page's named question, a live summary stat from one windowed query
  (`qDashboardStats`), whole card as the link — with the two ghost cards (cost,
  latency) in the same grid and a caption stating which stats use event membership vs
  containment (the outcomes card counts whole-contained sessions).
- Verified: app typecheck clean, biome clean, 25/25 app tests (render smoke covers the
  revised shell since routes are unchanged), screenshot pass over dashboard (top +
  category grid) and a tabbed room. Visual double-check via ui-visual-review skipped:
  no GEMINI_API_KEY in this environment.
