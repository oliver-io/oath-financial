# Data schema

Two newline-delimited JSON files in exactly the shape the Langfuse API returns. No fields
were added, removed or renamed. The structure is taken from real sessions; the content is
generated — see `DATA.md`.

| File | Rows | One row is |
|---|---|---|
| `data/traces.jsonl` | 763 | one **turn** — an auditor message plus the agent's reply |
| `data/observations.jsonl` | 8,082 | one event inside a turn — a span, a model call, or a tool call |

Window: about one month. 116 sessions, 4 clients, 7 auditors.

## How it fits together

```
session  (metadata.session_id, ordered by metadata.turn_number)
└── trace                      = one turn          traces.jsonl
    ├── SPAN        "Turn 12"        the turn envelope
    ├── GENERATION  "Claude Response" the model call (this is where token counts live)
    └── TOOL        "Tool: Bash"      one per tool invocation
```

Join on **`observations.traceId` → `traces.id`**. Each trace also lists its observation ids in
`traces.observations`, and tool calls nest under the turn span via
`observations.parentObservationId`.

There is no session object. A session exists only as a set of traces sharing
`metadata.session_id`.

## `traces.jsonl`

| Field | Notes |
|---|---|
| `id` | 32-char hex. Join key. |
| `name` | `"Turn N"` |
| `timestamp` | when the turn completed — **the reliable time signal in this dataset** |
| `input` | `{role: "user", content: "…"}` — what the auditor sent |
| `output` | `{role: "assistant", content: "…"}` — the agent's final text for that turn |
| `metadata.session_id` | groups turns into a session |
| `metadata.turn_number` | 1-based order within the session |
| `metadata.client` | client slug — one of 4, all fictional |
| `metadata.entity` | engagement entity within the client (`company`, `fund-i`, `fund-iii`) |
| `metadata.linux_user`, `metadata.auditor_email` | which auditor (fictional, consistent) |
| `metadata.source` | always `claude-code` |
| `metadata.resourceAttributes`, `metadata.scope` | OpenTelemetry plumbing; little analytic value |
| `observations` | ids of this turn's observations |
| `totalCost`, `latency` | **see the warnings below** |
| `projectId`, `htmlPath`, `environment`, `bookmarked`, `public` | Langfuse bookkeeping |

Session sizes are very skewed: **min 1 turn, median 3, max 76.**

Client distribution is skewed: one engagement dominates the window, with a long tail. One of
the four (`tealstone`) is an internal demo box rather than an engagement — worth deciding
whether it belongs in your analysis.

## `observations.jsonl`

| Field | Notes |
|---|---|
| `id`, `traceId` | 16-char and 32-char hex |
| `type` | `TOOL` (6,556) · `GENERATION` (763) · `SPAN` (763) |
| `name` | `"Tool: <name>"`, `"Claude Response"`, or `"Turn N"`. 146 distinct values. |
| `input` | tool arguments, or the model prompt. Present on all 8,082 rows. |
| `output` | tool result text, or the model completion. Present on 8,040. String, dict or list. |
| `metadata.tool_name` | 69 distinct tools — the cleanest handle on what was being done |
| `metadata.tool_id` | Anthropic `toolu_…` id, unique per call |
| `metadata.tool_count` | tools used in the parent turn |
| `parentObservationId` | set on 7,319 — nests tool and generation rows under their turn span |
| `level`, `statusMessage` | always `DEFAULT` / unset. **Not** an error channel. |
| `usageDetails`, `costDetails`, `modelId` | only on `GENERATION` rows, and only 714 of the 763 have them |
| `promptTokens`, `completionTokens`, `totalTokens`, `usage` | present but **all zero** — ignore |
| `startTime`, `endTime`, `latency` | **see the warnings below** |

Busiest tools: `Bash` 3,166 · `mcp__claude-in-chrome__computer` 691 · `Edit` 509 · `Read` 330 ·
`Agent` 307 · `mcp__claude-in-chrome__browser_batch` 263 · `Write` 222.

## Fields that will mislead you

These are real properties of how the telemetry was collected, faithfully carried over — not
artefacts of how this dataset was produced.

- **Durations are meaningless.** Every observation's `endTime - startTime` is under 0.31 s, and
  most are 0. That is the telemetry hook's own write time, not how long a tool ran. Per-tool
  timing is simply not in this dataset. The trace `latency` field is likewise ~0.003.
  *Real* elapsed-time signal exists only *between* turns (`traces.timestamp` deltas — median
  ~6 min, p90 ~2.3 h, and some sessions span days).
- **Token and cost numbers undercount by roughly 15–20×.** The hook logs only the per-turn user
  text and the final assistant text — not the full context that was actually billed. `totalCost`
  and `usageDetails` are internally consistent but bear no relation to real spend.
- **Nothing marks a failure.** `level` is always `DEFAULT`. Whether a tool call failed lives in
  the *text* of `output` (`"HTTP 403"`, `"command not found"`, `"no portal token found"`), so any
  error metric you build is a heuristic, and you should say so.
- **Amounts are invented** and mean nothing across turns (`DATA.md`).

## Quick start

```bash
wc -l data/*.jsonl
head -c 2000 data/traces.jsonl | python3 -m json.tool 2>/dev/null | head -40

# turns per session
python3 -c "
import json, collections
c = collections.Counter()
for l in open('data/traces.jsonl'):
    c[json.loads(l)['metadata']['session_id']] += 1
print(len(c), 'sessions'); print(c.most_common(5))
"
```
