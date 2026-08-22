# UI Plan

> Status: **READY.** Adversarially reviewed (coverage vs README, discovery test,
> presentation honesty at real cardinalities); review must-fixes folded in; open
> questions resolved (§7). Implementation plan for developers: `docs/plans/app.md`.

## 1. Design concept

**A findings brief with two rooms behind it.** The app opens on a ranked list of
actionable findings — the README's "five insights someone would act on beat forty
numbers" made literal — and every finding deeplinks into one of two visually distinct
sides: **Ops** (steel-blue identity: is the system healthy?) and **Product** (deep teal-green
identity: are people getting work done?). Every number wears a provenance chip
(structural / heuristic / curated / model), every classification can show its evidence,
and every path terminates in the session transcript viewer where a skeptic can see the
raw turns. Things the data cannot show are rendered as explicit disabled cards, not
silently absent.

**Who reads what (README personas vs. our rooms).** The README's two audiences are
*personas*; our two rooms are *data planes* (system vs. user-and-work), and they
deliberately cross-cut: the README's **Operations** reader (staffing, engagement
planning, recurring requests, stalls) lives mostly in `/ops/rhythm`, `/product/usage`,
and `/product/outcomes`; the README's **Product** reader (what to build/fix) lives in
`/ops` failures, `/product/agent`, and the capability-gap ledger. The system/user split
is the cleaner *data* boundary; the persona mapping is carried by the **finding cards'
audience tags, which are always README personas (OPERATIONS / PRODUCT)** — each card
deeplinks wherever its evidence lives, regardless of room.

## 2. Sitemap

| Route | Purpose (the one question) |
|---|---|
| `/` | **Findings** — "What should I act on this week?" |
| `/ops` | **Failures & incidents** — "What is breaking, how badly, one-off or systemic?" |
| `/ops/environments` | "Which client box is unhealthy?" (candidate to fold into `/ops`) |
| `/ops/rhythm` | **Working rhythm** — "How does work actually flow, per auditor and engagement?" (added on adversarial review: a verbatim README question had no construct) |
| `/product/usage` | "Who uses this, for what work, where is it concentrated?" |
| `/product/outcomes` | "Do tasks finish, what do they cost in human interactions, where is the wrestling?" |
| `/product/agent` | **Agent behavior** — "Where does the agent thrash, retry, or get corrected?" (added on review: the README's "where the agent needs better instructions" had no surface) |
| `/session/:id` | **Session viewer** — shared drill-down terminus; the trust-builder |

**Time window control (first-class, app header, CloudWatch-style):** presets (24h / 7d /
30d / full range) + a brush, global to both sides, URL-encoded. Defaults to the **full
dataset range** (a one-month static dataset must not open on an empty 24h view). Window
membership semantics differ by side, and each view states its rule:
- **Ops side = event semantics.** Every ops construct is turn/tool-event grain; an event
  is in the window iff its timestamp is. Sessions appear on the ops side only as
  drill-down links, never as counting units — nothing is excluded.
- **Product side = whole-session containment.** Session-grain views count a session only
  if it began *and* ended inside the window, with a visible caption — "N sessions
  overlap this window but aren't fully contained (excluded)" — clickable to list them.
  Edge-censoring caveat (long sessions vanish near window boundaries) is documented in
  the caption's tooltip.
- Mixed-grain pages (`/product/usage`: turns/day timeline is event-grain, job-type share
  is session-grain) carry both rules, each captioned.
- Crossover links compose the two: an incident's "see the work this cost" sets the
  product window to the incident span; containment + caption then apply.

**Data delivery:** the app fetches time-partitioned Parquet (fact plane) plus a small
global reference plane, per `docs/architecture/etl.md` stage 5; partitions are
content-addressed and cached immutably by the browser; all in-view aggregation runs
client-side via DuckDB-WASM. (This does not un-cut the query-builder *UI* — DuckDB-WASM
returns strictly as the invisible query engine behind the canned views; all SQL lives in
one typed module.)

Shared **filter bar** on all pages except `/`: client/entity (select), auditor (select),
job type (multi-select, model chip on the control itself), and an
**"include demo traffic"** toggle (default off; when on, demo rows render hatched).
All filter state, including the time window, lives in URL query params — every view and
crossover link is shareable.

## 3. Construct inventory

### Navigation shell (revision — user directive)
- **Horizontal navbar with tabbed sub-categories**: the two rooms are top-level nav
  entries whose sub-pages render as horizontal tabs within the room — Ops:
  `Failures · Environments · Rhythm`; Product: `Usage · Outcomes · Agent`. The room
  identity color underlines the active tab set; the shared filter bar sits below the
  navbar and persists across tab switches (URL state unchanged in shape — tabs are the
  existing routes).

### `/` Hub (revision 2 — user directive 2026-08-22: hub/router, not a dashboard)
The landing page is a **hub/router** to the two rooms — no finding cards, no charts:
- Title + one-line subtitle framing "one dataset, two rooms".
- Two side-by-side **room cards** — "Ops — system health" (steel-blue accent) and
  "Product — the work" (teal-green accent) — each with its framing question and its
  sub-categories (Ops: Failures & incidents, Environments, Working rhythm; Product:
  Usage, Outcomes, Agent behavior) as navigation entries with one-line descriptions.
- A **deliberately-not-built caption** (cost/token analysis, per-tool latency) with
  reasons — README traps 2 & 5, made visible.
- Shared header (time-window control + Ops/Product tabs) and run/rules-version footer.

Superseded revision 1 (dashboard: ranked finding cards + compact headline visuals +
category-card grid) is preserved in git history; the finding cards and headline charts
live in their rooms instead. `ref/findings` remains an ETL output; the hub does not
render it.

### Findings presentation (revision 3 — user decision 2026-08-22: removed from the app)
The in-app findings presentation is **removed entirely** — no finding cards anywhere,
including the room dashboards. The README's "what you found" is a written deliverable
divined from our own use of the tool (`FINDINGS.md`), not an app feature: rule-templated
cards blur authorship and over-claim (synthetic prose with no producer behind it). The
data plane is unaffected — `ref/findings` stays in the serving contract as
machine-readable structured output; it simply has no UI surface. Room dashboards are
pinnable widget boards only (every construct is a panel with a detail view on its page
and a widget view pinnable to its room's board; the tile title links back to the
anchored detail).

### `/ops` Failures & incidents
- **Failure time series** (stacked bar, x=day, y=error events, color=signature_class,
  ≤7 classes): "when and what kind?" **Incident bands** = shaded date regions; clicking
  a band opens an incident side panel (blast-radius counts, member signatures,
  `linked_friction_cost`, and the crossover link "see the work this cost →" =
  `/product/outcomes` filtered to the incident window).
- **Signature table** (the heart of the page; row = failure_signature): name · class chip
  · events · **sessions** · auditors · first/last seen · terminal-rate bar ·
  **post-failure-shape micro-bar** (3 segments: same-tool-clean-later / other-calls-after
  / turn-ends-on-failure — the structural distribution; semantic recovery labels are
  model-class and appear only with `M` chips where enrichment supplies them). Default
  sort: sessions desc — systemic floats. A **group-by toggle (none / client / auditor)**
  re-pivots the table without a query builder — the one cross-dimension pivot the
  discovery test showed the canned views were missing. Row click expands: daily
  sparkline, sample matched outputs (verbatim, with the rule id that fired),
  affected-session links.
- **Controls:** "include Agent-tool failures" toggle, default off, tooltip explaining the
  poisoned subagent outputs; rule-table version stamp in the footer.

### `/ops/environments`
- **Client × signature-class heatmap**, cell = errors per 100 tool calls (normalized).
  Cell click → `/ops` filtered. Small-n cells (<200 calls) render dotted with a warning
  tooltip.
- **Telemetry-integrity strip**: resumed fragments, missing turns, generation rows
  missing usage — observability of the observability.

### `/ops/rhythm`
Answers the README's verbatim question: "what can you say about an auditor's working
rhythm that would help someone planning an engagement?" All constructs are turn-grain →
event semantics. The gap cap is shown as a ⚙ stated parameter on every construct here.
- **Activity strips** (one row per auditor, x = day, cell intensity = turns that day;
  demo traffic hatched): "who was active when" — makes the end-of-window crunch and the
  late-onboarding auditors visible without annotation.
- **Bout profile** (per auditor: bouts/day and median bout span, small-multiple bars,
  `H` chips): one-sitting workers vs fragmented-attention workers.
- **Wall-span vs engaged-time scatter** (dot = session; x = `wall_span`, y =
  `capped_gap_span`, log axes; dot click → session): the "27-day session was 3 hours of
  attention" correction, as a picture. Footnote states why wall-span is never summed.
- **Quick-restart strip** (events where the same auditor starts a new session <1h after
  the last, per day; click → the session pair): workflow granularity, explicitly
  captioned as *not* implying continuation (per `docs/architecture/derivations.md`).

### `/product/usage`
- **Job-type share** (horizontal bar, sessions by job_type, `M` chip) with a one-line
  concentration callout ("top 3 job types = N% of sessions"). Bar click → session list.
- **Lines-of-business timeline** (**stacked bars**, turns/day by client — bars, not
  area: with one client at ~70% and another present only 2 days, area interpolation
  fabricates ramps and hides slivers) — shows the end-of-window crunch without
  annotation.
- **Request recurrence table** (row = job_type × client: session count, active-span
  sum, **first/last occurrence + per-week counts as a mini-strip**): the README's
  "which requests keep coming back" — a job type recurring for the same client across
  the window is either a candidate for automation or a task that keeps failing; the
  drill-down to its sessions says which.
- **Auditor × client grid** (dot matrix, dot size = active days, not turns). Deliberately
  unranked — no totals column; footnote states the auditor↔client confounding.
- **Capability adoption strip** (per tool family: # auditors using it, **plus a per-row
  usage sparkline over the window** — trends must be discoverable, not just totals) —
  makes "browser automation has one adopter; docstore abandoned for shell pdftotext"
  visible as outliers, and shows whether each pattern is growing or dying.

### `/product/outcomes`
- **Outcome bars per job type** (stacked: completed / abandoned / **undetermined as
  first-class hatched grey**, always in the legend with its count; `M` chips). The view
  leads with a caption — "N of M sessions determined" — and its headline number is
  completion-rate-among-determined, so a large undetermined share reads as honest
  coverage, not as "the tool knows nothing." Unclassified (abstention/error) renders as
  its own slice, distinct from undetermined.
- **Interaction cost strip plot** (dot per completed session: x = human-authored-turn
  count, row = job type; `H` chip under the marker-flag definition). Outlier dots
  clickable → session.
- **Friction table** (row = session, sorted by friction_share desc): friction bar ·
  dominant_friction_cause chip · job type · outcome. Rows with cause=`system_failure`
  carry the **crossover chip**: "↗ portal-auth-403 in Ops" → `/ops?signature=…`. Cause
  chips have evidence popovers (model justification + pointer turns).
- **Capability-gap ledger** (row = gap): name · sessions · auditors · interaction-cost
  estimate · **sessions/day sparkline** (a workaround growing 10× across the window is
  a different priority than a stable one) · evidence-pattern popover. Sorted by cost.
  This table *is* the ranked feature backlog; rows link to exemplar sessions.

### `/product/agent`
Answers the README's "where does the agent need better instructions." Turn/event-grain
constructs (event semantics, captioned) with model-class labels only where enrichment
supplies them — counts are facts, names are judgments.
- **Repeat-chain table** (row = turn, ranked by `identical_input_chain_count`): tool ·
  chain length · session link · whether any repeat followed a signature match. No
  "thrash" label on the facts; an `M`-chipped judgment column appears only when
  enrichment classified it.
- **Grind table** (row = turn, ranked by `max_same_tool_run`): tool family · run length
  · session link. Threshold is a ⚙ stated parameter; browser-family rows dominate and
  crosslink to the related capability-gap row.
- **Correction feed** (turns where `is_correction`, `M` chip): the user-re-steer list,
  each with the previous turn's assistant tail in a popover — a curated review queue,
  not a metric.
- **Post-failure behavior by tool family** (3-segment bars of `post_failure_shape`):
  where the agent presses on vs stops after failures — structural, no recovery claims.

### `/session/:id`
- Header: client/entity, auditor, dates, flag chips (demo, resumed_fragment), job_type
  and outcome chips with evidence popovers (`outcome_evidence` + pointer turns).
- **Turn timeline** (vertical): gap spacers between turns labeled with real elapsed time
  (log-scaled height; >2h gaps visually distinct). Per turn: **marker badges** — not an
  exclusive origin icon, since a turn can be typed *and* carry a paste — for
  task-notification / skill-body / extract-paste, plus a typed-prefix size badge; user
  text collapsed beyond 500 chars; **tool-sequence strip** (one colored block per call,
  color = family, red ring = counts-as-failure signature match; block click → popover
  with the rule fired and matched output snippet); assistant text collapsed;
  platform-limit marker rendered as a banner on the turn where it appears.
- Tool-sequence strips use **run-length compression**: consecutive same-tool calls
  render as one block with an ×N badge (turns reach 131 calls; uncompressed strips are
  unusable — and the compressed form *is* the grind visualization, giving
  `max_same_tool_run` its visual home).
- Reachable from every table in the app — the answer to "prove it."

## 4. Crossover mechanics

One shared entity (failure signature / incident), two directions, always a visible chip,
never a merged view:
- **Product → Ops:** any `system_failure` friction cause or finding card renders the
  linked signature as a chip; click = `/ops` with that signature selected and the date
  brush set.
- **Ops → Product:** incident panel and signature detail show "work impact" (sessions
  touched, summed linked friction); click = `/product/outcomes` filtered to those
  sessions.

## 5. Provenance & honesty patterns

- **Chips — diet applied**: `H` (amber, heuristic) · `C` (curated taxonomy) · `M`
  (steel blue, model) on metric titles and classification chips; hover = one-line method +
  link to the derivations.md entry. **Unchipped means structural** — chipping everything
  made the chips noise; one legend in the app header states the convention.
- **Evidence popovers** on every heuristic/model value: matched rule + verbatim text for
  `H`; model justification + pointer turns for `M`.
- **Stated parameters** (gap cap, quick-restart window, count thresholds): ⚙ popover on
  affected charts showing value + one-line rationale; display-only in v1.
- **Undetermined is a color in every legend**, never a filtered-out residue.
- **Ghost cards / footnotes** for forbidden views (cost, latency, auditor rankings,
  cross-turn amounts) at the exact spot a user would look for them.

## 6. Cut list (considered and rejected)

- **Ad-hoc query builder / DuckDB-WASM explorer** — six canned, well-aimed views answer
  the README's questions; the builder is infrastructure-over-insight within the timebox.
  The v2 item.
- **Auditor performance rankings** — auditors ⊆ clients; hopelessly confounded. The dot
  grid shows load without implying skill.
- **Cost & token views, per-tool latency** — documented traps; ghost cards only.
- **Prose/topic mining views** — measures the text generator.
- **Tealstone deep-dive page** — the demo toggle covers it.
- **Real-time/alerting anything** — one-month static batch; pretending otherwise is
  theater.
- **Session-comparison / diff views** — high build cost, unclear action.

## 7. Resolved questions

1. **Finding-card generation: threshold rules.** Decided and already baked into the ETL
   (`rules/findings.yaml`, stage 5 emits `ref/findings`). The LLM's judgment enters
   findings only through the classified fields the rules aggregate — never as prose
   generation on the landing page.
2. **`/ops/environments` stays a separate route** in the spec, but its two constructs
   are one component each — fold into `/ops` as a lower section if build time tightens;
   this is a layout decision the implementer may make, not a data-contract change.
3. **Filter bar on `/`: demo-toggle only.** Findings are global claims; the time window
   and dimension filters apply from the two rooms inward.
