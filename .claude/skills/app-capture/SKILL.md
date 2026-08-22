---
name: app-capture
description: State-aware screenshot capture of the running app for visual review. Use whenever you need a screenshot of any app page/state — it deep-links to the exact state via URL (the app's only state store), waits on the app's data-capture-state readiness contract (never sleep timers), refuses wrong-state captures (no accidental loading-skeleton shots), and emits a PNG ready for the ui-visual-review skill.
user-invocable: true
---

# /app-capture — deterministic, state-aware app screenshots

Capture the app **in a known state, on purpose**. The failure mode this skill
exists to prevent: screenshotting a loading skeleton (or an error state) and
reviewing it as if it were the page.

`$ARGUMENTS`

## Why deep links, not navigation or a test-renderer

- **The URL is the app's only state store** (app.md §3): every page, tab,
  filter, time window, and crossover state is a shareable URL. So "render the
  page with a given state" = load its deep link. No click-driving, no
  navigation scripting.
- **The fixture pack parameterizes the data side**: the normal run
  (`fixture-run-0001`) vs the degraded run (`fixture-run-degraded`) selects
  enriched vs degraded rendering; real data is the same app pointed at a real
  run tree.
- **Considered and rejected — a render-in-test harness** (mounting constructs
  with injected props, Storybook-style): pixel-deterministic and fast, but it
  bypasses the real data plane, so its screenshots show what the props claim,
  not what the app does — and it adds a second UI surface to maintain. Our
  smoke-only frontend testing philosophy says no. Integration truth wins.

## The readiness contract (loading-awareness)

The app shell maintains `<html data-capture-state="...">`:

| state | meaning |
|---|---|
| `booting` | data plane initializing (manifest/partitions/DuckDB-WASM) |
| `loading` | page queries in flight — skeletons visible |
| `ready` | every mounted construct's query resolved; no skeletons |
| `empty` | queries resolved to first-class empty states (e.g. empty window) |
| `error` | loader or construct error state showing |

The capture script polls this attribute and **only captures when the state
equals what you asked for** (default `ready`). Asking for `ready` while the
app settles into `error` is a refusal (exit 5), not a screenshot. Skeleton
shots are still *possible* — but only by explicitly requesting
`--state loading`. Fonts are awaited and transitions/animations are disabled
before capture, so pixels are deterministic.

If the attribute is missing (older build), the script refuses blind capture
unless you pass a `--wait-for <selector>` fallback, and stamps the capture
`contract:none`.

## How to run

```
bun .claude/skills/app-capture/scripts/capture.ts \
  --route "/ops?signature=portal-auth-403&from=2026-03-28&to=2026-04-01" \
  --out scratch/ops-auth-incident.png \
  [--state ready|loading|error|empty]   # default ready
  [--base http://localhost:5173]        # dev server; point at serve tree for real data
  [--width 1600 --height 1200] [--full-page]
  [--wait-for "table[data-construct=signature-table]"]  # extra gate, composes with contract
```

- Requires the dev server (or any static host of a run tree + SPA) running;
  the script launches/reuses its own headless Chrome on a debug port (9223).
- Output: PNG + one JSON line on stdout (state, contract used, bytes,
  viewport). Blank-page captures (<8KB) are refused.
- Exit codes: `0` captured · `2` usage · `3` chrome/CDP · `4` timeout waiting
  for the requested state · `5` wrong state / refused capture.

## State recipes

| Want | How |
|---|---|
| A room tab with filters | deep link with search params (`/product/outcomes?client=vestamar`) |
| Incident window | `?from=…&to=…` range params from the finding card's own link |
| Degraded (rule-only) rendering | serve/point `--base` at the degraded fixture run |
| Empty window | a range with no data + `--state empty` |
| Loading skeletons (deliberate) | `--state loading` (races the queries; retry if it settles too fast) |
| Error surface | break the base URL or use the malformed-manifest fixture + `--state error` |
| A single construct, tight | `--full-page` off + crop later, or `--wait-for` its selector and reduce viewport |

## Pipeline with ui-visual-review

Capture, then review — the two skills compose:

```
bun .claude/skills/app-capture/scripts/capture.ts --route "/ops" --out shot.png \
 && bun .claude/skills/ui-visual-review/scripts/review.ts --image shot.png --intent "…"
```

A capture that exits non-zero MUST NOT be sent to review; the review's verdict
is only meaningful for a state-verified capture. Record the capture JSON line
alongside the review verdict in progress notes.
