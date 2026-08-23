# infra — Pulumi AWS deployment

Implements `docs/plans/infra.md`. One private versioned S3 bucket + CloudFront
(OAC), a least-privilege deploy policy, nothing else. No application server.

## One-time setup (local file state backend)

```sh
# state lives in infra/.pulumi/ (gitignored); no external accounts
pulumi login file://./.pulumi          # run from infra/
export PULUMI_CONFIG_PASSPHRASE=""     # PowerShell: $env:PULUMI_CONFIG_PASSPHRASE=""
pulumi stack select dev                # or prod
```

The passphrase secrets provider is intentionally empty: the stack config holds
no secrets (region + flags only). To harden later:
`pulumi stack change-secrets-provider`.

Tradeoff (documented per plan §5): the file backend has no locking/concurrency —
correct for a single operator; moving to Pulumi Cloud is `pulumi login` + state
migration, zero program changes.

## Deploy (requires an authenticated AWS session)

```sh
pulumi preview            # always before up
pulumi up                 # idempotent — a second up must no-op
bun run deploy:app        # from repo root: vite build → upload → invalidate /index.html
bun run deploy:data -- --source build/serve                 # real ETL runs
bun run deploy:data -- --source contracts/fixtures/static   # fixture runs (alternate)
bun run parity -- https://<distribution-domain>             # checklist §4
```

`authMode` is `none`, so the URL is public. The `dev` stack is the deployed
stack of record — it serves https://oath.oliver-io.online.

## Config schema (per stack)

`aws:region` (default us-east-1) · `authMode` (`none` | `unlisted`; `sso`
reserved) · `prune` (default false) · `domain` (optional custom domain, e.g.
`oath.oliver-io.online`; when set, an ACM cert is DNS-validated against the
parent Route53 zone and A/AAAA alias records point the domain at the
distribution).

## Known deviation (reported, not silently adapted)

CloudFront custom-error responses are distribution-wide, so a missing object
under `/runs/` returns the SPA shell instead of a real 404 — parity checklist
item 5 passes locally (`bun run serve:prod-local`) but fails deployed. The
no-Lambda-class fix is a ~10-line viewer-request CloudFront Function, which the
plan's deliberately-not-built list forbids without sign-off. See
`docs/PROGRESS_LOG.md`.
