# _HANDOFF_APP.md — orchestrator handoff: the app track (goal-based loop)

Handoff for the agent building the frontend, running as a **goal-based loop in parallel
with the ETL track** (whose separate handoff is `docs/_HANDOFF.md`). One agent, one
track, iterating milestone by milestone until the definition-of-done below is met.

## Parallelism boundary — read first

Another agent is concurrently building the ETL shell under `docs/_HANDOFF.md`. To avoid
collision:

- **You own**: `app/**`, `contracts/**` (you create it), and your progress-log entries.
- **You never touch**: `etl/**`, `docs/_HANDOFF.md`, the root challenge files
  (`README.md`, `DATA.md`, `SCHEMA.md`, `data/`), or any `docs/architecture/*` /
  `docs/plans/*` spec content (spec contradictions are *reported*, not fixed —
  see below).
- **The single coordination artifact is `contracts/`** (per `docs/plans/app.md` §2):
  you author the zod schemas and fixture generator from the docs; the ETL track adopts
  them at its M2. Because the ETL agent may not have adopted them yet, treat the
  architecture docs as the contract's source of truth and transcribe *exactly* —
  invented or "improved" columns will surface as cross-track breakage later.
- Shared root files (`package.json` workspaces, Biome config): additive changes only;
  if the ETL agent has already created them, extend, don't rewrite.

## Context to load (in order, before any code)

1. `CLAUDE.md` — project, conventions, do-not-build list.
2. `docs/plans/ui.md` (**READY** — the construct-level spec: every page, chart, table,
   control, caption, and drill-down you will build, including window semantics and the
   honesty affordances).
3. `docs/plans/app.md` — **your implementation plan**: toolchain, `contracts/`, module
   layout, data-layer design, component conventions, §6 appearance (financial-firm
   restrained, no bright colors, no purple, validated palette), testing philosophy,
   milestones A0–A6.
4. `docs/architecture/etl.md` stage 5 + `docs/architecture/infrastructure.md` — the
   serving contract and delivery model you consume (time-partitioned Parquet, two
   planes, manifest, `latest.json`, immutable caching, "presents as REAL" rules).
5. `docs/architecture/derivations.md` — field semantics behind every column you render
   (provenance classes, outcome enum states, what is deliberately non-derivable).
6. Skim `docs/PROGRESS_LOG.md` — rejected patterns (episodes, origin enum, semantic
   recovery labels, auditor rankings) must not be reinvented in the UI.

## The goal loop

Work `app.md` §8 milestones **in order** (A0 → A5; A6 and the M2 flip depend on the ETL
track and are out of your loop — stop at A5-complete). Each iteration:

1. **Plan** the milestone against its spec sections; list the constructs/files it
   delivers.
2. **Build** per the conventions (`app.md` §5–§6 are binding: shared components for all
   honesty affordances, semantic theme tokens only, URL as the only state store, SQL
   only in `queries.ts`).
3. **Verify**: smoke tests green (`app.md` §7 — render + navigation only; do NOT build
   a larger test suite, that scope is deliberately capped); typecheck + lint clean;
   **render the result and look at it** — load the app against the fixture pack and
   check each new construct for label collisions, overflow, empty/degraded states, and
   both side identities. Eyeballing is the primary verification for this track; a
   milestone with passing tests but an unviewed UI is not done.
4. **Record**: append a short milestone entry to `docs/PROGRESS_LOG.md` (what shipped,
   deviations, open questions).
5. **Re-derive the next step from the specs**, not from momentum — if the specs and the
   code disagree, the specs win.

### Milestone gates (definitions of done)

- **A0**: `contracts/` schemas transcribed (every table, enum, and key from the docs);
  fixture generator emits a synthetic run tree that zod-validates against them,
  including the degraded-mode variant; DuckDB-WASM boot spike runs one query in-browser
  against a fixture partition; **palette finalized via the validator with the report
  checked in as theme tokens**. This gate is the coordination point — record a clear
  note in the progress log that contracts are ready for ETL adoption.
- **A1**: all routes render with theme identities; time-window control + filter bar +
  URL codec round-trip (URL → state → URL byte-stable); loader handles
  manifest→partition flow incl. malformed-manifest and empty-window states; degraded
  context wired.
- **A2**: session viewer complete against the worst fixtures (76-turn session, 131-call
  turn via run-length compression, 46KB collapsed message, platform-limit banner,
  marker badges, evidence popovers).
- **A3/A4**: each ops/product page's constructs match `ui.md`'s inventory item-for-item
  — including captions, chips, ⚙ stated parameters, group-by toggle, sparklines,
  hatching, excluded-count caption, crossover links landing with filters pre-set.
- **A5**: findings cards render from `ref/findings` fixture rows; ghost cards present;
  every drill-down path from card → room → session viewer walks end-to-end.

## Deliverable priority (MDD)

The challenge README rewards **insight over route-completeness**. If time forces cuts,
the minimum defensible deliverable is: `/` findings + `/ops` + `/product/outcomes` +
`/session/:id`, fully working against fixtures — with the remaining routes present as
**ghost-card stub pages listing what they would show** (that itself demonstrates the
README's "taste about what not to build" criterion). Prefer four excellent pages over
eight half-pages; the milestone order (A0→A5) already reflects this — do not reorder
it, but treat A3's `/ops/rhythm`, `/ops/environments`, and A4's `/product/usage`,
`/product/agent` as the droppable tail. Finding-card `audience` tags are README
personas (OPERATIONS / PRODUCT), per `ui.md` §1's who-reads-what paragraph.

## Escalation (stop and surface, don't improvise)

- A spec contradiction between docs → record it (progress log + your report) with a
  proposed resolution; adopt the precedence: `derivations.md` on fields,
  `architecture/etl.md` on the serving contract, `ui.md` on constructs, `app.md` on
  implementation.
- The serving contract lacks a column a `ui.md` construct needs → do **not** invent it
  in `contracts/`; flag it as a cross-track issue.
- DuckDB-WASM proves unusable for a construct → the fallback discussion belongs to the
  user; do not silently switch to JSON fetching.
- Anything on the do-not-build list, however tempting (cost views, latency, rankings,
  a query-builder UI) → no.

## Ground rules

- Dependency budget: `app.md` §1's list; additions need written justification there.
- Testing is capped at `app.md` §7's smoke scope (render + navigation + contract
  conformance). Building more UI tests than that is out of scope, even if it feels
  virtuous. No network calls in tests; fixtures only.
- Appearance rules are binding: no bright colors, **no purple**, unchipped = structural,
  tabular numerals in every table, one-axis rule, hatching for uncertainty states.
- The app must present as REAL (infrastructure.md): no demo banners, manifest-derived
  coverage, first-class empty states, per-partition loading skeletons.
