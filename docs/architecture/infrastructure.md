# Infrastructure & Deployment — deployment & serving

How this is deployed and served. The stance: **a real internal tool with POC stand-ins**,
where every stand-in preserves the *interface* of the production component it substitutes
— so scaling is a swap of implementations, never a redesign. The UI presents as if
backed by arbitrary data volume; the one-month test set is simply the only data loaded.

## Topology

```
                    ┌─ ETL runner (scheduled batch) ──────────────┐
 Langfuse ─────────►│ bun etl run  →  partitioned Parquet + manifest│
 (POC: local JSONL) └───────────────┬─────────────────────────────┘
                                    ▼ publish (atomic)
                    object store  /runs/<run_id>/…   /runs/latest.json
                    (POC: local build/serve/ dir)
                                    │ immutable, content-addressed
                                    ▼
                    CDN / static host  ── also serves the SPA bundle
                    (POC: one Bun static file server)
                                    │ HTTPS + SSO at the edge
                                    ▼
                    Browser: SPA + DuckDB-WASM + cached partitions
```

There is no application server. The entire runtime backend is static file delivery; all
compute is either offline (ETL) or client-side (DuckDB-WASM). This is the property that
makes the scale story credible: serving cost is CDN bandwidth, and query capacity is the
user's own machine.

## Components

### 1. Data publishing (object store layout)

```
/runs/latest.json            → { "run_id": "…", "published_at": … }   (the ONLY mutable object)
/runs/<run_id>/manifest.json → partitions per resolution, date coverage, enrichment coverage
/runs/<run_id>/facts/turns/day=<date>.parquet
/runs/<run_id>/facts/tool_events/day=<date>.parquet
/runs/<run_id>/rollups/…     → (future, see Scale) downsampled fact aggregates per week/month
/runs/<run_id>/ref/*.parquet → reference plane, whole
```

- **Everything under a run id is immutable** → `Cache-Control: public, max-age=31536000,
  immutable`. `latest.json` is `no-cache`. Deploys and rollbacks are both "repoint
  latest" — atomic, instant, zero invalidation logic.
- Old runs are retained (cheap) — the manifest history *is* the audit trail of what was
  ever shown, matching the ETL's run-manifest discipline.
- **Production**: S3/GCS/R2 behind the org CDN. **POC**: `build/serve/` on disk, same
  paths. The frontend knows only the layout, so the swap is a base-URL change.

### 2. Static host / SPA

- The React SPA is a static Vite build deployed to the same host; it discovers data via
  `latest.json` → manifest → window-selected partitions. Zero environment variables in
  the client; everything is path-relative.
- **Production**: CDN + object store. **POC**: one `Bun.serve()` static server (~30
  lines) serving `dist/` + `build/serve/` with correct cache headers — kept only because
  it forces us to get the header/caching behavior right locally.

### 3. Authentication & access

- **Production**: SSO at the edge — reverse-proxy OIDC (oauth2-proxy / Cloudflare Access
  / IAP) in front of the static host. The app is deliberately auth-agnostic:
  cookie-based edge auth, no client secrets, no login UI, no per-user state — so adding
  SSO requires **zero application changes**. Trace data is client-confidential in the
  real deployment; the edge proxy is the control.
- **POC**: none (localhost). The zero-app-changes property is the deliverable here.

### 4. ETL runner

- **Production shape**: a scheduled batch job (CI runner / cron container) that (a)
  pulls new traces from the Langfuse API since the last run's high-water mark, (b)
  writes *only new day partitions* for the fact plane, (c) rebuilds the reference plane
  (it is aggregate-sized and stays small — rebuilding it whole is the simplicity we pay
  for), (d) runs enrichment for new records (the cache makes this incremental
  automatically), (e) publishes a new run id and repoints latest. The append-only
  partition layout is what makes the incremental story a *file-copy optimization*
  (unchanged day partitions are re-linked, not recomputed) rather than a new pipeline.
- **POC**: `bun etl run` invoked manually against the checked-in JSONL, full rebuild
  (seconds). Same output layout, same manifest, same publish step to the local dir.
- LLM credentials live only in the runner's environment. The browser never talks to a
  model; there is no key to leak client-side.

### 5. Pipeline observability (the tool's own ops)

- Run manifests published alongside data double as pipeline telemetry: row counts, gate
  results, enrichment coverage, wall times. **Production** adds: run-failure alerting
  from the scheduler, a retention policy, and a manifest-diff check (row counts shrinking
  unexpectedly = publish blocked). **POC**: the manifest files themselves + the fork/
  referential gates already abort bad publishes.

## The scale story

What actually changes at 1000× data volume (years, thousands of sessions/day), and what
is already built for it:

| Concern | Already handled by design | Deferred until real scale |
|---|---|---|
| Fact volume | Day partitioning + window-bounded fetch: the browser only ever downloads its window. Parquet row-group pruning + HTTP range requests via DuckDB-WASM reduce even that. | Sub-partition hot days (hour grain) when a day file exceeds a size budget (~15 MB); the manifest already lists partitions explicitly, so grain is per-partition, not global. |
| Wide windows (a year view) | Manifest declares **resolutions**; UI picks resolution by window span — CloudWatch's own trick. | Emit `rollups/` (pre-aggregated fact summaries per week/month: event counts by signature/class/client/day) in stage 5. Charts read rollups for wide windows; drill-down past a zoom threshold switches to raw partitions. Reference plane unaffected. |
| Reference plane growth | Sessions grow linearly but rows are tiny; aggregates grow with taxonomy, not volume. | Partition `ref/sessions` by month-of-last-turn when it exceeds a few tens of MB; containment queries touch only windows' months. |
| Enrichment volume | Job/cache design is incremental by construction (only new records lack cache rows). | Move the runner from inline concurrency to the provider's batch API; budget alarms. |
| Serving | CDN + immutable objects: no capacity planning at all. | Nothing. This is the point of the architecture. |
| Multi-tenancy / auth | Edge SSO, no app changes. | Per-engagement authorization would require splitting runs per client boundary — a publish-layout decision, not an app rewrite. |

## Presenting as REAL

Rules the UI follows so the POC reads as a production tool over arbitrary data:

- **No demo affordances.** No "sample data" banners; the dataset boundary appears only
  as the manifest's date coverage, exactly as a real deployment's would.
- **Empty windows are first-class**: selecting a range with no data renders proper empty
  states ("no events in this window"), not errors — the UI never assumes data exists.
- **The UI never assumes the dataset fits in memory**: all fetches are manifest-driven
  and window-bounded even though today's whole dataset is a few MB. (The full-range
  default window is a *manifest-derived* default, not a hardcoded month.)
- Loading is skeleton-based per partition fetch, so behavior under real latency is the
  behavior we build and see.
- The `_meta`/manifest-driven degraded captions (enrichment off) present as operational
  states of a real pipeline, which is what they are.

## Deliberately not built (and why it's safe to skip)

- Kubernetes/containers for serving — static files need none; the ETL container comes
  with the scheduler when there is one.
- A metadata database — the manifest chain is the metadata store at this scale and well
  beyond.
- Server-side query tier — the resolution/rollup mechanism defers it indefinitely for
  this workload class; if a future feature genuinely needs cross-window ad-hoc SQL over
  years of facts, that is DuckDB on a box reading the same Parquet — the layout is
  already its native format.
