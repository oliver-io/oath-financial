# Architecture Overview

Component spec for the trace-insights tool. Two halves: the data architecture (ingestion →
derived data) and the UI architecture (presentation). See `docs/architecture/derivations.md` for the derived
data points themselves.

# DATA ARCHITECTURE

> Status: **settled** — six-stage layout below; full detail in the companion docs.

The pipeline is a staged, re-runnable batch ETL. Each stage reads only the stage before it,
writes its own artifact, and can be re-run independently. Nothing mutates raw data.

```
stage 0  RAW        traces.jsonl / observations.jsonl → raw tables, verbatim
stage 1  CLEAN      validation, integrity gates (fork gate aborts), identity flags
stage 2  DERIVE     row-level facts only (matches, counts, gaps, markers)
stage 3  ENRICH     model judgments over facts (LLM jobs, cached, optional)
stage 4  AGGREGATE  signatures, incidents, timelines over merged verdicts w/ provenance
stage 5  PUBLISH    fact views (all dims denormalized) + precomputed views → serving
```

Aggregation is deliberately *downstream* of enrichment so model verdicts (gray-zone
failure adjudication, session outcomes) can reach the aggregates; without stage 3 the
pipeline still completes over rule-only verdicts. Full technical detail in
`docs/architecture/etl.md`; enrichment jobs in `docs/architecture/llm.md`; field definitions in
`docs/architecture/derivations.md`.

# UI ARCHITECTURE

> Status: **settled.** Bipartite app: an ops-observability side and a
> product-analytics side over the same derived data, with crossover deeplinks via the
> shared failure/incident entities. Full concept (sitemap, per-page constructs,
> provenance patterns, cut list): `docs/plans/ui.md` (READY); implementation plan:
> `docs/plans/app.md`.
