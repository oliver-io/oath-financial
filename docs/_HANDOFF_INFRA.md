# _HANDOFF_INFRA.md — orchestrator handoff: the infrastructure track (goal-based loop)

Handoff for the agent building the AWS deployment and local/prod parity layer,
running as a **goal-based loop in parallel** with the ETL track (`docs/_HANDOFF.md`)
and the app track (`docs/_HANDOFF_APP.md`). One agent, one track, iterating phase by
phase until the definition-of-done below is met.

## Parallelism boundary — read first

Two other agents are concurrently building in this repo. To avoid collision:

- **You own**: `infra/**` (the Pulumi workspace and `infra/scripts/`), and your
  progress-log entries.
- **Additive-only**: root `package.json` (add the `deploy:data` / `deploy:app`
  scripts and the `infra` workspace entry — extend, never rewrite; the ETL and app
  agents also touch this file additively), `.gitignore` (state dir).
- **You never touch**: `etl/**`, `test/**`, `app/**`, `contracts/**`, the root
  challenge files (`README.md`, `DATA.md`, `SCHEMA.md`, `data/`), or any
  `docs/architecture/*` / `docs/plans/*` spec content. Spec contradictions are
  *reported* in your phase notes, never fixed silently. You READ the app's fixture
  tree (`contracts/fixtures/static/runs/…`) and, once it exists, the ETL's
  `build/serve/` output — you never write into either.
- `RUNNING.md`: you may append a short "Deploy" section once I2 lands (it is
  grader-facing — keep it to the two commands and the parity checklist pointer).

## Context to load (in order, before any code)

1. `docs/architecture/infrastructure.md` — the authoritative topology and the
   POC-stand-ins-preserve-production-interfaces principle you are implementing.
2. `docs/plans/infra.md` — **your implementation plan**: the exact AWS shape (one
   private S3 bucket + CloudFront OAC, nothing else), the cache-behavior/header
   table (parity-critical), publish atomicity ordering, the local/prod parity
   checklist, Pulumi mechanics (local file backend, stack config schema), and the
   deliberately-not-built list.
3. `docs/architecture/etl.md` stage 5 — the artifact tree you serve
   (`runs/<run_id>/…` + `runs/latest.json`, hive-style `day=<date>` partitions).
4. `RUNNING.md` + `CLAUDE.md` — grader-facing framing and project conventions.
5. Peek (read-only): `contracts/fixtures/static/runs/` — the fixture run trees that
   are your I3 payload; `app/vite.config.ts` + `app/src/data/loader.ts` — the live
   local serving contract (`publicDir` → `/runs/*`, loader boots
   `${baseUrl}/latest.json`) your deployment must match byte-for-byte in behavior.

## The goal loop

Work the phases **in order**. Each iteration: plan against the spec → build →
verify per the requirements below → record a short entry in
`docs/PROGRESS_LOG.md` (APPEND only; never renumber existing sections — the file
has known numbering quirks from concurrent writers) → re-derive the next step from
the specs, not momentum.

### Phase gates (definitions of done)

- **I0 — scaffold.** `infra/` workspace with own `package.json` (Pulumi deps here,
  outside the etl/app budgets); Pulumi program skeleton; **local file backend**
  configured (`file://` login, state gitignored, passphrase provider documented);
  `dev` and `prod` stacks defined with the config schema (`region`, `domain?`,
  `authMode?`, `prune?`); `pulumi preview` runs clean (empty or planned-only);
  typecheck + lint clean.
- **I1 — the stack is up.** Bucket (private, versioned) + OAC + CloudFront with the
  §1 cache behaviors and SPA custom-error fallback; IAM deploy principal with the
  least-privilege policy; outputs exported (bucket name, distribution domain). A
  hello artifact (any file) uploaded and served through the distribution over HTTPS.
  `pulumi up` twice = idempotent (second run no-ops).
- **I2 — deploy scripts + parity.** `deploy:data` and `deploy:app` implemented per
  plan §3 (per-path Cache-Control headers exactly per the table; upload-then-swap
  `latest.json` ordering; invalidation of only the two mutable objects; `--prune`
  gated). The **parity checklist (plan §4, items 1–6) passes against BOTH the local
  server and the deployed URL** — automate it as a small script in `infra/scripts/`
  so it is re-runnable; curl evidence in your phase notes. RUNNING.md "Deploy"
  section appended.
- **I3 — end-to-end M2-flip rehearsal.** Publish the app's fixture run trees
  (`fixture-run-0001` + the degraded variant) and the built SPA to the dev stack;
  the deployed URL serves the app with identical behavior to local dev (both
  fixture runs loadable by switching `latest.json`, degraded captions appear on the
  degraded run). This proves the flip property from the serving side before the
  real ETL output exists. When ETL M2's `build/serve/` lands, a single
  `deploy:data` of it must need **zero** infra changes — state that check in your
  final report.

## Verification requirements (every phase)

- `pulumi preview` before every `up`; `up` must be idempotent (re-run = no changes).
- Header assertions via curl for every path class in the plan §1 table — headers are
  the contract, not a styling detail.
- Atomicity demonstrated: during a `deploy:data`, `latest.json` must reference a
  fully-present run at every instant (verify by fetching it mid-deploy or by
  ordering proof in the script + a post-deploy object-count check vs the manifest).
- Never deploy real `data/` derived output containing… actually: the trace dataset
  is synthetic by construction, but the rule stands — **only fixture runs deploy
  until the user explicitly says otherwise** (authMode is `none`/unlisted; treat
  the deployed URL as public).

## Escalation (stop and surface, don't improvise)

- **Credentials/region/account**: anything requiring AWS credentials, account
  choice, or region preference the user has not provided is a stop-and-ask — never
  guess an account, never create credentials.
- **No new AWS services** beyond plan §1's table without user sign-off (that
  includes "just one small Lambda"). The deliberately-not-built list is binding.
- Cost surprises (anything that isn't pennies at this scale) → surface before `up`.
- A conflict between the app's local serving behavior and the plan's parity table →
  report it; do not change `app/**` and do not silently adapt the deployed behavior
  away from the plan.

## Deliverable priority (MDD)

**I0–I2 are the floor** (stack up + deploy scripts + parity proven). I3 is the goal
state and depends only on the app fixture pack, which already exists. If time forces
cuts, a working I2 with the checklist passing locally and against the dev stack
satisfies the infrastructure story; write what remains as next steps in your final
progress-log entry.
