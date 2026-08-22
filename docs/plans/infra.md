# Infrastructure Implementation Plan (AWS · Pulumi)

The developer-facing plan for deploying the tool specified in
`docs/architecture/infrastructure.md` (authoritative topology) to AWS, and for keeping
local development behavior-identical to production. Code-free but concrete. Premise:
the final architecture exists as specced — `docs/architecture/etl.md` stage 5 defines
the artifact tree, `docs/plans/app.md` the SPA build. Guiding principle carried over
from infrastructure.md: **there is no application server** — serving is static files +
CDN; all compute is offline ETL or client-side. The deployment must therefore be as
close to "a bucket and a CDN" as AWS allows, and nothing more.

## 1. Target AWS shape (minimal, serverless)

One Pulumi stack producing exactly:

| Resource | Purpose | Notes |
|---|---|---|
| **S3 bucket** (one, private) | Holds BOTH the SPA build (`index.html`, hashed assets at the root) and the data tree (`runs/…`) | No public access; no website mode (CloudFront OAC does the reading). Versioning on (cheap rollback insurance for `runs/latest.json`). |
| **CloudFront distribution** | The only public surface | OAC to the bucket; default root object `index.html`; SPA fallback: 403/404 → `/index.html` 200 (custom error responses — no Lambda needed); HTTP→HTTPS redirect. |
| **Origin Access Control** | Bucket stays private | Standard OAC + bucket policy allowing only the distribution. |
| **IAM deploy principal** | Least-privilege publish | `PutObject`/`DeleteObject`/`ListBucket` on the bucket + `CreateInvalidation` on the distribution — nothing else. Used by the deploy scripts and CI. |
| *(optional)* ACM cert + Route53 records | Only when stack config provides `domain` | Otherwise the plain `*.cloudfront.net` URL is the product. Cert in us-east-1 (CloudFront requirement). |

**Explicitly absent**: load balancers, containers, Lambda@Edge/CloudFront Functions,
API Gateway, databases. Candidate Lambdas were considered and rejected: publish
atomicity is ordering (upload → swap pointer), done by the deploy script wherever the
ETL ran; the SPA rewrite is a static custom-error response. If a future need for a
function appears, it must be justified in this file first.

### Cache behaviors (the parity-critical table)

| Path pattern | CloudFront behavior | Cache-Control set at upload |
|---|---|---|
| `runs/<run_id>/**` (incl. all Parquet + per-run `manifest.json`) | cache: long | `public, max-age=31536000, immutable` |
| `runs/latest.json` | cache: none | `no-cache` |
| `assets/**` (Vite content-hashed) | cache: long | `public, max-age=31536000, immutable` |
| `index.html` | cache: none | `no-cache` |

CloudFront respects origin headers (`CachingOptimized` for immutable paths /
`CachingDisabled` for the two mutable objects via two behaviors) — the headers
travel with the objects, so **the same header table is enforced locally** (see §4).

## 2. ETL execution stance

The pipeline runs **locally or in CI** (it is a seconds-long batch over a static
dataset) and *publishes* via the deploy scripts. A scheduled serverless runner
(EventBridge Scheduler → containerized `bun etl run` or a CI cron) is the documented
next step for live-data operation — specced here, **not built now**. Nothing in the
Pulumi surface changes when it arrives: it would reuse the same IAM publish policy.

## 3. Publish flow (identical local → prod)

Two commands, wired additively into the root `package.json`, implemented in
`infra/scripts/` (Bun scripts wrapping the AWS CLI / S3 SDK):

- **`bun run deploy:data`** — publishes `build/serve/` (the ETL stage-5 output; until
  ETL M2, `contracts/fixtures/static/runs/` works identically):
  1. Upload the complete new `runs/<run_id>/` tree with immutable headers.
  2. Verify the upload (object count vs manifest partition list).
  3. **Swap `runs/latest.json` last** (no-cache header) — same atomicity-by-ordering
     as local publish.
  4. Invalidate exactly `/runs/latest.json` (nothing else — everything under a run id
     is immutable by construction).
- **`bun run deploy:app`** — `vite build` then upload `app/dist/`: hashed `assets/**`
  immutable, `index.html` last with `no-cache`; invalidate exactly `/index.html`.

Old runs are retained (rollback = re-swap `latest.json`; the audit trail per
infrastructure.md). No sync-deletes of prior runs without an explicit `--prune` flag.

## 4. Local/prod parity

Going local → prod must change **only the base URL**. The local static server (the
app's Vite dev server today; a ~30-line `Bun.serve` for prod-shaped local serving)
implements the same interface:

- Same paths: `/runs/<run_id>/…`, `/runs/latest.json` (the app's loader already boots
  from `${baseUrl}/latest.json` with base `/runs`; the Vite `publicDir` already serves
  `contracts/fixtures/static` verbatim — this contract is live in the repo today).
- Same headers per the table in §1 (`immutable` on run dirs and hashed assets,
  `no-cache` on `latest.json` and `index.html`).
- Same SPA fallback: unknown non-file path → `index.html` 200; unknown file path under
  `/runs/` → real 404 (the loader treats missing partitions as errors, and prod S3
  will 404 — local must not mask that with the SPA fallback).

**Parity checklist** (run against both local and the deployed URL; automatable with
curl):
1. `GET /runs/latest.json` → 200, `no-cache`, valid per contracts schema.
2. `GET /runs/<run_id>/manifest.json` → 200, `immutable`.
3. Any fact partition → 200, `immutable`, correct content-type.
4. `GET /some/spa/route` → 200 `index.html`, `no-cache`.
5. `GET /runs/<run_id>/missing.parquet` → 404 (not index.html).
6. Re-upload of an existing run id is a no-op or error — never a silent overwrite.

## 5. Pulumi mechanics

- **Layout**: `infra/` as its own workspace — own `package.json` (Pulumi deps live
  here and do **not** count against the etl/app dependency budgets), `Pulumi.yaml`,
  one program (`index.ts`), `infra/scripts/deploy-data.ts` + `deploy-app.ts`.
  TypeScript; run under Bun where the Pulumi CLI allows, Node fallback is acceptable
  for the Pulumi program itself (the CLI drives it — document whichever works, don't
  fight the toolchain).
- **State backend**: **local file backend** (`pulumi login file://…`, state under
  `infra/.pulumi/`, gitignored; passphrase secrets provider). Tradeoff, documented:
  no team concurrency/locking vs. zero external accounts and nothing to provision —
  correct for a single-operator POC; moving to Pulumi Cloud later is `pulumi login` +
  state migration, no program changes.
- **Stack config schema**: `region` (default `us-east-1`), `domain?` (enables
  ACM+Route53), `authMode?` (`none` | `unlisted` today; `sso` reserved — see §6),
  `prune?` (default false).
- **Stacks**: `dev` and `prod` only. Same program, different config.
- **CI check**: `pulumi preview` runs as a non-mutating check alongside typecheck/
  lint/test; `pulumi up` is always human-invoked for now.

## 6. Auth stance

Production auth per infrastructure.md is edge SSO, and the app is deliberately
auth-agnostic. This deployment ships `authMode: none` (public-but-unlisted CloudFront
URL) as the default; the `sso` mode is reserved config that would front the
distribution with the org's SSO proxy **without any app or bucket change** — the
zero-app-change property is the deliverable, not a login. No basic-auth Lambda is
built (it would be the stack's only function; rejected for minimalism — "unlisted +
client-confidential-free fixture data" covers the POC, and real data does not deploy
until SSO exists).

## 7. Deliberately not built

Containers/ECS/EKS; schedulers (EventBridge runner is specced §2, not built); WAF;
Lambda of any kind; multi-env beyond dev/prod; Route53/ACM unless `domain` is set;
cross-account/org plumbing; S3 replication/lifecycle policies (retention is "keep
everything" at this scale); CloudWatch dashboards for the CDN (the run-manifest chain
is the tool's own telemetry).
