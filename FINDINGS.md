# FINDINGS — one page

*What we found in the traces, what we'd build next, what we deliberately left out.
Every number below was verified directly against the JSONL during analysis; the
pipeline (see `RUNNING.md`) reproduces them as queryable Parquet.*

## What we found

1. **A portal-authentication wall is the single systemic failure.** 207 anchored
   auth-failure events across 63 of 116 sessions, touching **all 7 auditors** — plus a
   3-day incident (Mar 29–31: 24/42/43 events/day vs. single digits before). Damning
   detail: the error text prints its own remediation command, which appears in **zero**
   subsequent tool calls — either recovery happens off-box (an observability gap) or
   the remediation path is broken.
2. **Three missing CLIs account for 100% of command-not-found failures** (117 events,
   50 sessions, every auditor). A bounded provisioning/instruction fix, not a long tail.
3. **Document-location work is ~45% of all sessions** (receipt checks, "where is X",
   inventory sweeps) — the top candidate for a purpose-built capability instead of
   improvised shell searches. Related: `pdftotext` appears in 79/116 sessions while
   the sanctioned docstore tools total ~140 calls and fail ~half the time they're used.
4. **Browser automation is a fallback, not a feature**: all 954 browser calls sit in
   just 17 sessions, 9 of which also hit portal-auth failures; single turns reach 108
   click/screenshot calls. Each grind is a missing API.
5. **Wall-clock session length is an illusion** — the longest "27-day" session contains
   under 3 hours of engaged time. Staffing/planning signals must come from inter-turn
   gaps (bouts), never from session spans; the tool is built around this correction.
6. **Sessions are fragments**: 39 same-auditor restarts within an hour. We investigated
   merging them into work episodes and **rejected it on evidence** — no hard linkage
   exists (one telemetry-truncated fragment with no predecessor, zero forks), and
   textual continuation markers turned out to be artifacts of the data generator. The
   session stays the unit of analysis; restart density is reported as a workflow-
   granularity fact.

**Traps found beyond the seven documented**: per-observation input↔output texts are
independently generated (never join them); 299/307 Agent-tool outputs are one failure
template (poisons naive error rates); bare `403`/`404` regexes match invented dollar
amounts; the demo *user* and the tealstone demo *client* are different sets; telemetry
drops turns (one session starts at turn 22); a platform spend-limit marker exists in
assistant text but does not reliably mark session death; `check-auth` reports `valid`
252× while portal calls in the same turns still return 403/no-token — the auth status
check is an untrustworthy instrument, so "portal auth" is infra friction to attribute,
never a category of work (we removed it from the job taxonomy on this evidence).

## What we'd build next

Model-based enrichment (session outcomes, friction attribution, a sampled audit that
puts error bars on the heuristic failure counts) — specced, quarantined, and optional
by design; multi-resolution rollups for wide time windows; incremental ingest from the
live Langfuse API. Full specs: `docs/architecture/`.

## What we deliberately left out

Cost/token dashboards (fields undercount 15–20×), per-tool latency (durations record
telemetry write time), auditor performance rankings (auditors ≅ clients; confounded),
cross-turn amount arithmetic (amounts invented), prose mining (template-generated), an
ad-hoc query-builder UI (canned views + a group-by pivot answer the real questions),
and session merging (above). The UI shows these as explicit "this data cannot support
X" cards rather than omitting them silently. We also removed an in-app "findings
brief" late: findings are conclusions we drew from using the tool — they belong in
this document (and as queryable `ref/findings` rows), not as a UI surface implying
the app divines insights itself.