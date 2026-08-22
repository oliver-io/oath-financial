# Running the tool

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1 (runtime, package manager, test runner — no Node needed)
- Optional, for LLM enrichment only: an OpenAI-compatible API key
  (`OPENAI_API_KEY`; optional `OPENAI_BASE_URL`, `ETL_MODEL_FAST`,
  `ETL_MODEL_STRONG`) — **the pipeline runs fully without it** in degraded
  (rule-only) mode.

```
bun install
```

## Pipeline (offline, produces everything the app reads)

```
bun run etl run --no-enrich   # deterministic pipeline: stages 0–2, 4–5 (no API needed)
bun run etl run               # full run incl. LLM enrichment (cached; <1,500 calls)
bun run etl enrich --job J3   # run/resume one enrichment job (J1..J5)
bun run etl run --sqlite      # also writes build/inspect.sqlite (local inspection only)
bun run test:etl              # ETL integration suite (no network; no credentials)
```

Output: `build/serve/` — time-partitioned Parquet + `manifest.json` + `latest.json`.
This tree is both what the app serves and the machine-readable deliverable ("structured
output" per the challenge README); a committed sample run from the provided data lives
in `sample-output/` (fully enriched: all five LLM jobs ran with complete coverage —
see `manifest.json` `enrichment`; a `--no-enrich` run produces the same tree with
enrichment columns NULL by design).

## App

```
bun run dev                 # serves the SPA against contracts/fixtures until M2,
                            # then against build/serve/ — a base-URL flip
```

Open the printed URL. Landing page = a hub routing to the two rooms (`/ops` and
`/product/*`); every value drills down to the session transcript it came from.
Findings live in `FINDINGS.md` (the written deliverable) and as queryable rows in
the published `ref/findings.parquet` — deliberately not as a UI surface.

## Deploy (AWS, optional)

```
bun run deploy:app          # vite build → S3 → invalidate /index.html
bun run deploy:data         # publish build/serve/ (immutable upload, latest.json swapped last)
```

Stack: `infra/` (Pulumi — one private S3 bucket + CloudFront; see `infra/README.md`).
Parity checklist: `bun run parity -- <base-url>` against both `bun run
serve:prod-local` and the deployed URL (`docs/plans/infra.md` §4).

## Reading order for an evaluator

`FINDINGS.md` (one page — what we found) → this file → `CLAUDE.md` (project guide) →
`docs/` (full architecture and plans, including cut lists and the progress log with
our reversals).