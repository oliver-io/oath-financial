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

## 26. A6-nav visual-review pass (Gemini double-check now live)

- Orchestrator's ui-visual-review run flagged one legitimate major on the dashboard:
  finding cards spanned only half the content width. Fixed — two-column card grid at
  xl, with an odd final card spanning both columns. (Its second flag — solid incident
  band "should be hatched" — was refuted: ui.md specs bands as shaded regions;
  hatching is reserved for uncertainty states.)
- GEMINI_API_KEY now sourced from the repo .env (GOOGLE_AI_STUDIO_API_KEY, CRLF-safe
  extraction); reviews run locally. Iterated: compact ActivityStrips now scale via
  viewBox instead of clipping, with right padding so the last axis label survives.
  Final reviews: dashboard bottom (zones 2+3) PASS, dashboard top PASS with no
  visual defects. Gates re-verified: tsc clean, biome clean, 25/25 app tests.

## 27. App track — app-capture readiness contract (data-capture-state)

- The shell now maintains `<html data-capture-state="booting|loading|ready|empty|error">`
  per .claude/skills/app-capture: one shared counter store (`app/src/data/captureState.ts`)
  fed by the states the app already tracks — boot phases from DataProvider, an in-flight
  counter in useRows (symmetric with effect cleanup), mounted ErrorState/EmptyState
  components self-reporting, and the loader reporting zero-partition windows so the
  empty-window exemplar registers even where pages use inline empty text.
- **Settled states are debounced (400ms)**: the first pipeline run caught a real race —
  "ready" fired in the gap between a page's query batch settling and a deeplink-expanded
  row mounting its own queries, so the capture showed an unpopulated expansion and
  mid-animation (invisible) chart bars. Fixed by the debounce plus
  `isAnimationActive={false}` on all Recharts bars (deterministic pixels).
- Verified via the composed pipeline: capture(ready → /ops?signature=…) + ui-visual-review
  = PASS; --state empty capture on an out-of-coverage window works; a broken run URL
  settles into "error" and a ready-capture is refused as specced. States also checked
  directly (ready/empty/error) via CDP. Gates: tsc clean, biome clean, 25/25 app tests.
  app-capture is now the capture half of visual verification for this track.

## 30. ETL M3 — stage-3 enrichment (runner, client, cache, packets, J1-J5); suite fully green

- Built: LlmCache (bun:sqlite WAL, key = sha256(job|packet_hash|prompt_version|model),
  cleared only by --recache); OpenAiClient.complete (structured outputs; SDK errors →
  typed LlmHttpError/LlmTimeoutError; stale backoff comment fixed — policy lives in the
  runner); five pure packet builders with the zero-spend escape hatches
  (missing_source_field, structural elision → packet_overflow); the generic runner
  (cache-first → bounded transport retries w/ exponential backoff via injected sleep →
  one schema-repair retry → post-hoc validation → transactional per-batch writes →
  exactly-one-row invariant → coverage); real prompts/selectors/writers for J1-J5
  (J4/J5 pulled forward — the matrix/canary/resume tests exercise them);
  stages/executor.ts extracted so `etl enrich` bootstraps s0-s2 without import cycles.
- Judgment calls: sequential processing instead of p-limit ~8 (sleep-spy determinism
  tests require deterministic call order; documented); transport bounds are versioned
  data (thresholds thr-v2: max_transport_attempts 6, backoff_base_ms 250); batched
  calls accept an N-array or a single broadcast object; J5 samples exclude NULL-output
  events (unauditable, burned the fixed budget); enrich tables renamed to
  j2_verdicts/j3_verdicts; coverage: cached records count in judged AND cached_hit.
- Schema reconciliation (readiness item): kept `unreadable_context`/`other` in
  InsufficientReasonSchema + nullable J1 reason — tests require them; llm.md to gain
  the two branches at M4 (doc reconciliation) rather than code losing them.
- **One test amended by the orchestrator** (llm_matrix "persistent 500"): the strict
  bound `callCount < judged + 10` is arithmetically unsatisfiable under the shared
  per-call ScriptedClient cursor (callCount = judged + fives_consumed; an error record
  plus judged records necessarily consume all 10 scripted 500s, so equality holds
  exactly). Changed to <= with an explanatory comment; every behavioral assertion
  (single error row, bounded retries, job continues) was already passing.
- Verified by orchestrator: `bun test ./test` **108 pass / 0 fail**; tsc + biome
  clean; real-dataset degraded run still publishes end-to-end (exit 0, 48 partitions).

## 28. Infra track — I1–I3 live at https://oath.oliver-io.online (dev stack)

- Domain support built (plan §1 optional row, user-directed): `domain` config now
  provisions an ACM cert (DNS-validated against the parent hosted zone, us-east-1),
  distribution aliases (SNI, TLSv1.2_2021), and Route53 A/AAAA alias records. dev
  stack config: `domain: oath.oliver-io.online` (zone Z03668002G8ZI7HWZUOPK,
  account 778157431261).
- **I1**: `pulumi up` created 13 resources in 4m32s (bucket `site-2d1a0db`,
  distribution `E2V8KT0VMPK8HL` / d3k09n6n2xsvph.cloudfront.net); second `up` =
  **13 unchanged** (idempotency proven).
- **I2**: `deploy:app` (6 files, index.html last) and `deploy:data` shipped. Script
  fixes en route: spawn env now defaults `PULUMI_CONFIG_PASSPHRASE=""` (documented
  provider); SDK clients pinned to the stack region (default-region mismatch caused
  S3 PermanentRedirect).
- **I3**: both fixture runs published (57 objects each, count-verified before each
  pointer swap); `latest.json` swapped 0001 → degraded → 0001 — the flip is a
  pointer write + one invalidation, zero infra changes. Re-publish of
  fixture-run-0001 correctly no-opped ("already published — skipping upload"):
  parity item 6 evidenced.
- **Parity checklist**: local prod-shaped server (`serve:prod-local`) **5/5 PASS**;
  deployed **4/5 PASS** — item 5 fails deployed exactly per the §27 conflict report
  (missing /runs/ object → SPA shell via distribution-wide custom-error responses).
  Decision still pending with the user: sanction a ~10-line viewer-request
  CloudFront Function or accept the deviation.
- M2-flip statement: when ETL M2 lands, `bun run deploy:data` against `build/serve/`
  needs zero infra changes — proven by the fixture rehearsal above.

## 2026-08-22 — Landing page: dashboard revision reversed to hub (user directive)

- User directive: `/` is a **hub/router** to the two rooms, not the three-zone
  dashboard of ui.md revision 1. ui.md §Dashboard rewritten as §Hub (revision 2);
  finding cards + compact headline visuals dropped from `/` (they live in the rooms;
  `ref/findings` remains an ETL output).
- Evidence: app-capture of `/` (state `ready`, contract `data-capture-state`) +
  ui-visual-review — dashboard intent **fail** (both missing-zone blockers), hub
  intent **pass** (0 mismatches, 0 visual defects). The built page already was the hub.
- Tooling notes: capture must run under PowerShell on Windows (Git Bash mangles
  `--route "/"` into a filesystem path); ui-visual-review needs `GEMINI_API_KEY`
  mapped from `.env` `GOOGLE_AI_STUDIO_API_KEY`.

## 31. ETL M4 — J5 error bars, findings gating, doc reconciliation, sweep (ETL complete)

- J5 error bars: s4 computes `j5_false_positive_rate` / `j5_missed_rate` from
  enrich.j5_audit as GLOBAL instrument rates on every signature row (per-signature
  splits of a 100/150 sample would be small-n noise — in the SQL header); NULL when J5
  absent or bucket under `small_n_call_threshold`. `incidents.linked_friction_cost`
  implemented (J2 friction where cause=system_failure, non-dangling link = incident
  signature, turn inside the excursion window); NULL degraded.
- findings.yaml → fnd-v1: two requires_enrichment cards (`portal-auth-friction-cost`,
  `abandoned-sessions`) publish only when enrichment ran and claim gates pass;
  degraded card set unchanged.
- Doc reconciliation (orchestration-approved spec edits): llm.md — J1 reason nullable,
  shared insufficient_reason space (+unreadable_context/other), batched-response
  contract documented; derivations.md — measured post_failure_shape 484/67/49 recorded
  vs provisional numbers.
- Sweep: `--sqlite` implemented (etl/lib/inspect.ts → build/inspect.sqlite, 16 tables,
  never served); latent production bug fixed — persistent pipeline.duckdb kept an
  old-shape enrich table forever under CREATE IF NOT EXISTS; ensureEnrichTables now
  drops/recreates on column-set mismatch (LLM cache is the durable store).
  shell-pdf-pipeline recorded as a decided non-gap (needs tool input text; documented
  in findings.yaml). RUNNING.md ETL sections refreshed; sample-output/ regenerated
  (run 20260822T212643-59a005ce, fnd-v1/sig-v1).
- No live LLM calls made (mid-flight guard honored; all real runs --no-enrich).
- Verified by orchestrator: **108/0**, tsc + biome clean. ETL implementation M1-M4
  complete; next step is the user-gated staged enriched run (J3 --limit 10 first).

## 28. Navigation final form + per-room dashboards (user directive, supersedes §25 nav)

- **`/` is a pure data-free index** (no queries): two room cards (Ops / Product) listing
  each room's sub-pages with their named questions; brand link in the top bar returns
  here. The former all-in-one dashboard is gone.
- **Each room has its own dashboard at its root**: `/ops` = ops findings (audience-
  filtered) + compact failure time series + daily-activity strip + category cards
  (Failures/Environments/Rhythm stats, Tool-latency ghost); `/product` = product
  findings + compact job-type share (with containment caption) + category cards
  (Usage/Outcomes/Agent stats, Cost-analysis ghost). Shared dashboard components live
  in `components/dashboard/` (FindingCards with audience prop, CategoryCard/Ghost,
  CompactPanel).
- **Route change**: the Failures page moved `/ops` → `/ops/failures`; all deeplinks
  updated (finding target links, friction-table and incident-panel crossovers, time-
  series band clicks, environments heatmap cell clicks). URL codec unchanged.
- **Chrome is back to the original two pieces**: the top control bar (brand · window
  control · filter bar · provenance note — filters hidden on the index and session
  viewer) and the left vertical nav rail with OPS and PRODUCT section headers (each a
  link to its room dashboard, tinted when active) and sub-categories indented beneath —
  the intermediate horizontal-navbar/tab experiments are removed.
- index.html now stamps `data-capture-state="booting"` statically so app-capture never
  sees a contract-less document pre-boot (its first-poll refusal, found while testing).
- Gates: app tsc clean, biome clean, 27/27 app tests (route list updated for
  /ops/failures and /product). Verified by screenshot: top bar + rail + ops dashboard.

## 29. Room dashboards become pinnable widget boards (user directive)

- The room dashboards no longer carry a title/question header or a fixed layout —
  each is a **tiled board of pinned widgets** composed from the room's sub-pages,
  which keep their focused reports. Tile headers link back to the source page
  (room-color underline); every tile has an unpin ✕; a ⊕ add-widget picker lists the
  room's unpinned widgets.
- **Widget registry** (`components/dashboard/widgets.tsx`): self-contained renderers
  that fetch through the same queries.ts entries as the full pages (semantics cannot
  fork) — ops: findings, failure time series, daily activity, three stat tiles;
  product: findings, job-type share, outcomes-per-job-type, three stat tiles. Wide
  widgets span two grid columns.
- **Pinning from the pages**: Section gained an optional pin prop — a 📌 toggle on the
  constructs that exist as widgets (failure series, activity strips, job share,
  outcome bars). Pin state is a per-viewer convenience, so it lives in localStorage
  (try/catch-wrapped, per-room keys, sensible defaults when unset) — the URL remains
  the only store for shareable view state.
- Verified in-browser: pinning from /product/outcomes adds the tile to /product
  (persists across loads), unpin/picker work, defaults render for a fresh viewer.
  Gates: tsc clean, biome clean, 27/27 app tests.

## 32. Enrichment prompt/schema hardening after the 10-call sanity pass

- Capped sanity run (`etl enrich --job J3 --limit 10`, new --limit flag capping the
  SELECTED set so the exactly-one-row invariant holds) surfaced one incoherent row:
  outcome=completed + ended_mid_work=true on a session ending in a user thank-you.
  Root cause: the zod output schemas carried NO field descriptions — the structured-
  output JSON Schema was bare types — and the prompt defined ended_mid_work vaguely.
- Fix: every field of every J1-J5 output schema now carries a .describe() annotation
  stating purpose + value interpretation (z.toJSONSchema forwards these into
  response_format); ended_mid_work gained an explicit definition + coherence rule
  vs outcome; J3 prompt defers field semantics to the schema. All five prompt
  versions bumped to v2 (schema descriptions are model-visible → cache-poisoning
  rule; the header in enrichment.ts now states this).
- Re-run of the same 10 sessions on j3-v2: the offending row now completed/false with
  evidence citing the user acknowledgement; all 10 rows coherent (completed→false,
  abandoned→true, undetermined→true with mid-task evidence); one session improved
  other→capability_probe. 10 judged / 0 abstained / 0 error; suite still 108/0,
  tsc/biome clean. Cost envelope confirmed: J1 57 + J2 116 batched + J3 116 + J4 ~3 +
  J5 250 ≈ 540 calls, well under llm.md's 1,500.

## 30. Widget boards: content-fitted tiles + inverted pin control (user directive)

- **Sizing**: the board is now a wrapping flex row; widgets declare a size class —
  `stat` (packs several per row, capped width), `half` (~26rem basis, grows), `full`
  (whole row) — so small tiles like Turns no longer occupy half the board.
- **Inverted control**: the ⊕ add-widget picker is gone. Every widget is pinned from
  its natural page: constructs keep their Section 📌 toggle, and each sub-page's
  quick-stat widget pins from a 📌 next to the page title (its natural home). The
  board only unpins (✕ per tile). Findings have no sub-page home, so they are a fixed
  section at the top of each room board rather than a widget; default pins are now
  the room's headline visual(s) plus one stat.
- Verified in-browser: default product board packs job-share + two stat tiles on one
  row below findings; pin controls on /product/usage correctly show pinned state;
  no picker remains. Gates: tsc clean, biome clean, 27/27 app tests.

## 44. portal_auth removed from the job taxonomy (2026-08-22, user-driven data dig)

The user challenged the fixture dashboard's "What work is this used for?" chart showing
`portal_auth` as the dominant job type. A raw-trace investigation confirmed their
hypothesis and refuted the orchestrator's first framing ("auth-only sessions exist"):

- The `/audit-auth` skill fires 115× but always bare — never with a user request.
- Every session containing it (incl. all four 1-turn "auth-opening" sessions) performs
  substantive document work; **no session has authentication as its deliverable**.
- `check-auth` reports `valid` 252× while portal calls in the same turns still 403 —
  the status check is an untrustworthy instrument (new found-trap in FINDINGS.md).
- The fallback is structural: every browser `navigate` in the dataset targets
  `portal.example.com/documents`, followed by form-input grinding — the browser-grind
  capability gap's cause — or abandonment ("I can't continue" ×14).

Decision (user-approved): portal auth resembles an infra-alignment tool call, not a
source of work. Removed `portal_auth` from J3's `job_type` enum (llm.md,
derivations.md); auth is represented as ops failure signatures + J2 friction cause +
a product-side overhead/interruption metric, and the fixture generator must stop
emitting it as a job. Directives relayed to ETL and app tracks.
- Hub polish round (user feedback): dashboard link annotated with a room-colored
  "DASHBOARD ->" pill and sub-category links restyled as subordinate tinted nav rows
  with chevrons; content block truly centered (removed the flex-1 grid stretch that
  ate the below-fold slack). Adversarial design-intent review (not
  describe-what-is-rendered): **pass**, 0 mismatches, after failing iterations for
  dead space / imbalance — the intent wording now states the design goal and asks
  Gemini to flag any deviation.

## 33. Classifier-context hardening (session-boundary facts, digest honesty, enum trim)

- User concern validated: packets never told the model which turn was the session's
  first/last exchange — the classifier judged endings without knowing nothing follows.
  J2 packets gained a structural `position` block (is_first_turn, is_final_turn,
  session_turn_count, session_resumed_fragment; computed in the selector's whole-
  session window); J3 digests mark `is_first_observed_turn`/`is_final_turn` (marked
  pre-elision so boundaries always survive); both prompts state the semantics
  ("no turn follows anywhere in the data — what happened afterwards is unknowable,
  not implied"; first-turn null prev tail = none exists, unless resumed_fragment).
- Real-packet spot check (selector→builder dump on real sessions) caught two more:
  (a) the J3 digest's typed_prefix showed the raw user_content head — presenting
  harness-injected skill bodies as auditor-typed text; now honors typed_prefix_chars
  (empty when nothing was typed) and digests carry the marker booleans, with the
  prompt instructing not to read injected content as user intent; (b) a J2 prompt
  paragraph had been inserted mid-sentence — restructured.
- Sanity evidence the boundary context matters: session 09910e4b flipped
  completed→abandoned once the model knew the 49-call browser grind ending in
  portal-auth-403 was the last thing in the data.
- **portal_auth removed from the J3 job_type enum** (orchestrator directive, user-
  approved, spec commit 711d3f2): auth is infra friction with a browser-grind
  fallback, never a line of business; schema + description now instruct classifying
  auth-heavy sessions by their document work. Ops-side portal-auth-403 signatures and
  fixtures unaffected. llm_matrix enum loop updated (107 tests).
- Prompt versions: j2-v4, j3-v5 (packet/schema changes are model-visible). Suite
  107/0, tsc/biome clean. contracts/src/enums.ts still carries portal_auth (app-track
  owned; superset enum validates trimmed values — flagged to orchestration).

## 31. portal_auth removed from job taxonomy + auth-overhead crossover + widget invariant

- Per orchestrator directive (711d3f2): `portal_auth` removed from JobTypeSchema in
  contracts; fixture generator's job mixes redistribute the former portal-auth sessions
  across real document work (doc_location/tie_out/doc_receipt_check/doc_inventory)
  while keeping their portal-auth-403 failure signatures — auth stays an ops-side
  failure entity, never "work this is used for". Fixture parquet regenerated
  (52 partitions/run).
- **Auth-overhead stat** (the suggested product-side surface, done as a stat-slot
  widget rather than a new construct): distinct sessions touched by counting
  portal-auth-403 failures in the window (event semantics, captioned), with the
  ↗ portal-auth-403-in-Ops crossover chip per ui.md §4. Natural home: the outcomes
  page's friction section (pin there); pinnable to the product board.
- **Widget/page invariant** (user directive): every registry widget must be pinnable
  from its source page — PinControl now carries data-pin-id and names its widget
  ("pin \"Auth overhead\""), and a new smoke test mounts each widget's source page and
  asserts its pin control renders (11 invariant tests). Dashboards can no longer show
  a widget with no sub-page home (findings remain a fixed board section by design).
- Verified in-browser: job-share no longer lists portal_auth (tie_out now tops the
  mix); pinning Auth overhead from outcomes lands the tile with its crossover chip.
  Gates: tsc clean, biome clean, 38/38 app tests. Not committed — orchestrator sweeps.

## 45. Findings leave the UI (revision 3, user decision)

Prompted by the fixture card '"Portal work falls back to raw browser driving" is the
costliest workaround (667 human turns)' — synthetic fixture prose with no producing
rule behind it — the user ruled that findings are conclusions we draw from *using*
the tool: they belong in FINDINGS.md (the README's one-page deliverable) and as
queryable ref/findings rows, not as a UI surface implying the app divines insights.
Decision: remove the findings presentation from the app entirely (hub keeps only the
two room cards); ref/findings.parquet stays in the serving contract as structured
output; ETL untouched. RUNNING.md, CLAUDE.md BRIEF, and FINDINGS.md updated; app
track directed to record ui.md revision 3 and strip the components.

## 32. Panel system (detail + widget views) and findings-presentation removal

- **Every construct is now a panel** (user directive): the registry
  (`components/dashboard/widgets.tsx`) defines 25 panels — one shared title, source
  page, size class, chips, a DETAIL view rendered on its page via `<PanelSection>`
  (anchored, pinnable), and an optional WIDGET view for the dashboard (a summary —
  top-5 truncations for the signature/friction/repeat/grind tables, limited correction
  feed, compact strips — or the detail itself where a construct can't be summarized).
  Dashboard tile titles link to `source#panel-<id>`; the anchor re-scrolls as panels
  above settle (capture-state-aware). Detail renderers were extracted from the pages
  into self-fetching components (`components/ops/panels.tsx`,
  `components/product/panels.tsx`); pages are now thin compositions of PanelSections
  plus page-level chrome (Agent toggle, window-rule captions, excluded list, ghosts).
  Previously unpinnable constructs (bout profile, span scatter, heatmap, integrity,
  LOB timeline, auditor grid, adoption, agent tables, quick restarts) are all pinnable.
  The pinnability-invariant suite now covers all 25 panels (54/54 app tests).
- **Findings presentation removed** (orchestrator directive, ui.md revision 3 recorded):
  no finding cards anywhere — FindingCards deleted, boards are pinned tiles only, the
  hub keeps its two room cards + deliberately-not-built caption. `ref/findings` stays
  in the serving contract and fixtures as machine-readable output with no UI surface.
- Verified in-browser: bout profile pins from /ops/rhythm and renders on the ops board
  beside the compact strips and stat tiles; tile-title click-through lands the anchored
  detail in view; unified titles ("When is it failing, and what kind? →" on the tile =
  the page section heading). Gates: tsc clean, biome clean, 54/54 tests. Uncommitted —
  orchestrator sweeps.

## 34. Pre-full-run double-check: J1/J4/J5 packet review + live calibration

- Real-packet dump for the unscrutinized jobs: J5 snippets read exactly as the raw
  logs; J4 clusters correct with candidate-id validation sets. J1 had the same
  super-view gap as J2/J3: empty following_tools was ambiguous ("turn ended" vs
  unknown) and seq_index lacked a total — selector/packet now carry turn_tool_count +
  is_last_call_in_turn with the semantics stated in the prompt.
- Live capped J5 (8): every assessment agrees with the raw snippet, evidence quotes
  real text. Live capped J1 (6) exposed prompt-sensitivity both ways: v3 rubber-
  stamped non_failure/recovered_immediately ("agent continued afterwards"), v4
  over-corrected to uniform failure/high off the bare template. Fixes: recovered_
  immediately now means the SAME operation visibly succeeded on retry (continuing
  with other tools is not recovery — that is a failure worked around), and
  confidence=high requires discriminating context beyond the matched text (v5 result:
  5 low / 1 high failure verdicts — honest calibration; correct direction per the
  dataset's "error placement is trustworthy" property).
- Prompt versions at full-run launch: j1-v5, j2-v4, j3-v5, j4-v2, j5-v2. Suite 107/0
  throughout. Sanity spend total: 70 calls, all cached.

## 2026-08-22 — Copy audit and revision (all pages)

- Page-by-page copy audit (screenshots of every route) found: two page questions
  misdescribing their pages (Environments "client box... unhealthy" vs an error-rate
  heatmap; Rhythm promising "per engagement" with no engagement dimension), a systemic
  pattern of methodology self-defense in user-facing copy ("deliberately unranked",
  "why wall spans are never summed", "structural only", a derivations.md citation in a
  caption), and colloquialisms ("wrestling", "thrash", "one-sitting workers vs
  fragmented attention" — the latter a judgment about named people).
- Revised across IndexPage, OpsPage, OpsEnvironmentsPage, OpsRhythmPage,
  ProductOutcomesPage, ProductAgentPage, widgets.tsx titles, ops/product panels
  captions, honesty.tsx chip tooltip; ui.md sitemap questions synced. Question-style
  subtitles and window-rule captions kept; honesty rationale moved into neutral,
  reader-facing phrasing. Verified rendering on /ops/environments (ready-state capture).

## 2026-08-22 — Drill-in UX unified (marks are links)

- User request: in "Do tasks finish?" the graphed bar rows should be the drill-in
  targets rather than a row of generated buttons beneath — then a sweep for
  consistency everywhere.
- New standard: any clickable mark inside an SVG chart is a real link via the new
  shared `SvgDrillLink` (SVG `<a href>` with SPA navigation — middle-click/copy work,
  no role="button"/biome-ignore workarounds), always paired with a `<title>` saying
  what clicking does. Applied to: OutcomeBars rows (button row removed, replaced with
  a one-line hint), EnvHeatmap cells, SpanScatter dots, InteractionStrip dots.
  HTML contexts use react-router `Link` (quick-restart chips converted from buttons).
  Buttons remain only for non-navigation actions (ToolStrip evidence popovers,
  show/hide toggles) — buttons act, links navigate.
- Cross-panel deeplinks now preserve the current search and anchor to the target
  panel (`#panel-<id>`): "+N more" links (friction, quick restarts), grind→gap-ledger,
  job-share→outcome-bars, ops↗crossovers (friction table, auth-overhead widget) →
  `#panel-signature-table`, incident panel → member signatures anchored and
  "see the work this cost" → `#panel-friction-table`. Recharts ReferenceArea incident
  bands keep onClick (library constraint), retaining cursor + explanatory caption.
- Gates: tsc clean, biome clean, 54/54 tests.

## 35. First full enriched run + audit-driven corrections + parallel runner

- Full enriched run #1 (sequential): exit 0, all invariants held. Coverage: J1 57,
  J2 743+20 errors (one double-invalid batch — designed batch-grain behavior), J3
  116, J4 3, J5 250. Outcomes 81 completed / 28 abandoned / 7 undetermined; job mix
  led by doc_receipt_check/doc_location/tie_out; verdicts 543 rule + 57 model_added.
- **The J5 audit paid for itself on run #1**: missed-failure rate 34.7% decomposed
  into (a) a definition gap — the model flagged audit-content anomalies (amount
  mismatches, "no valuation memo", truncated telemetry) as failures; j5-v3 pins
  "failure" to tool/system failures only — and (b) one GENUINE rule-table blind
  spot: the Read tool's "Error: File does not exist:" wording, 115 occurrences
  (~= the whole grep-style signature). sig-v2 extends missing-file to both wordings
  (credited to J5 in its notes); golden suite green (no digits → no amount risk).
- **Runner parallelized** (user directive): p-limit over batches with concurrency
  from thresholds.yaml (`enrichment.concurrency: 8`, thr-v3); DB writes serialized
  via a mutex chain (transactional batches must never interleave on the single
  DuckDB connection); harness pins concurrency 1 as a declared determinism seam
  (scripted-client cursor) — at 1 the loop is exactly the old sequential order.
  Suite 107/0 unchanged.
- Corrective run #2 (parallel): **299s wall** for the full pipeline incl. ~660
  fresh calls (vs ~25 min sequential). J2 errors recovered (763/763, 0 errors);
  J1 56 judged + 1 honest abstention; **J5 missed rate 0.347 → 0.013, fp 0**;
  missing-file event_count 113 → 228. Outcomes 81/29/6; incident friction costs
  populated (portal-auth-403 Mar-30 = 8.85, the top crossover number). All four
  findings cards (2 degraded + 2 enrichment-gated) publish.
- sample-output/ refreshed to the enriched run (58 files, ~1.0 MB, run
  20260822T235047-59a005ce); RUNNING.md sample sentence updated accordingly.

## 29. Infra track — real ETL run live at https://oath.oliver-io.online (M2 flip done)

- `bun run deploy:data --source build/serve` published run `20260822T235047-59a005ce`
  (57 objects, count-verified, pointer swapped last, one invalidation). Fully
  enriched: J1 56 judged/1 abstained, J2 763, J3 116, J4 3, J5 250 — all zero errors.
- Zero infra changes were needed for the flip, as required by I3. One script
  adjustment only: deploy-data now accepts both runs-base layouts (fixture pack's
  `runs/` subdir vs the ETL serve tree being the base itself). Earlier fix in the
  same file family: `.wasm → application/wasm` content type (DuckDB bundle).
- Deployed parity re-run on real data: items 1–4 PASS; item 5 remains the reported
  CloudFront custom-error deviation (decision still pending).
