# Coding challenge — Trace Insights

## Context

Our auditors do their engagement work on per-client cloud workstations running Claude Code.
Every turn of every session emits a [Langfuse](https://langfuse.com) trace: the auditor's
message, the agent's reply, and every tool call in between.

That data has been piling up and nobody is reading it. We're exploring an internal tool that
turns it into **structured insights two different teams can actually use**:

- **Operations** cares about how the work is going — where auditors lose time, which requests
  keep coming back, which sessions stalled out and why, what that implies for staffing and
  engagement planning.
- **Product** cares about what to build and fix — which tools fail and how, what auditors are
  trying to do that the platform doesn't support, where the agent needs better instructions.

The same traces have to serve both. They want different things from them.

## What you get

```
data/traces.jsonl        one JSON object per trace  (= one Claude Code turn)
data/observations.jsonl  one JSON object per observation (spans, tool calls, generations)
SCHEMA.md                field reference — read this first
DATA.md                  where this data comes from — read this second
```

**The structure is real; the text is generated.** Session shapes, tool-call sequences, timings and
failure placement all come from real auditor sessions. The prose, identities and amounts are
invented, because the real ones are client confidential. `DATA.md` is precise about which is
which, and it matters for deciding what your findings can claim.

It is not a tidy sample: sessions run from one turn to 76, some are exploratory chatter, some are
hours of grinding work, some are auditors fighting the tooling and losing.

## The task

Build a tool that ingests these traces and produces structured insights for those two audiences.

Shape it however you think is right — CLI, notebook, API, small web app. Two constraints:

1. **Output must be structured.** Machine-readable, so something downstream can query and
   aggregate it. A wall of LLM prose is not a deliverable.
2. **The two audiences must be served distinctly.** Ops and Product should not get the same
   undifferentiated report with a different title.

Using an LLM as part of the pipeline is welcome but not required. If you do, we care about where
you put it and what you *don't* trust it with.

## What we're evaluating

- **Modelling judgment.** The data arrives turn-level. The right unit of analysis probably isn't
  a turn. How you decide, and how you defend it, matters more to us than how many metrics you
  emit.
- **Insight quality over metric count.** Five insights someone would act on beat forty numbers
  nobody reads.
- **How you handle things that aren't what they look like.** Some of the obvious signal in here
  is misleading — see *Known traps* below. We left them in on purpose. Noticing is the test.
- **Code we'd be happy to inherit.** Readable, tested where correctness actually matters, honest
  in its comments about what it doesn't handle.
- **Taste about what not to build.** Telling us "I skipped X because Y" is a strong answer.

## Known traps

We're telling you these rather than watching you fall in. Falling in anyway is the bad outcome;
finding *more* of them is the great one.

1. **One trace is one turn, not one session.** Sessions have to be reconstructed —
   `metadata.session_id` groups them, `metadata.turn_number` orders them.
2. **The token/cost numbers undercount real usage by roughly 15–20×.** The hook that produced
   these traces sends only the per-turn user text and the final assistant text — not the full
   conversation context that was actually billed. Do not build a cost dashboard on these fields.
   If cost matters to your analysis, say what you'd need instead.
3. **Turn count is not a success metric.** Long sessions skew productive; short ones skew
   abandoned. The naive "efficiency" reading of this data is backwards.
4. **There is no reliable error flag on tool results.** Whether a tool call failed has to be
   inferred from its output text, which means both false positives and false negatives.
5. **The `latency` and `startTime`/`endTime` fields on observations do not measure the work.**
   Every observation duration in this dataset is under a third of a second — they record how long
   the telemetry hook took to write the event, not how long a tool ran. "Which tool is slowest"
   is not answerable from this data. Elapsed time between *turns* is real signal; time within one
   is not.
6. **Monetary amounts are invented.** They're internally consistent within a turn but mean
   nothing across turns, so audit-figure arithmetic is not an available axis. It wasn't the
   interesting one anyway.
7. **The prose is generated, so don't mine it for subtle phrasing.** It's coherent and on-topic
   per turn, but template-based. Structure, tool behaviour and failure placement are the real
   signal — see `DATA.md`.

## Examples of the kind of question this could answer

Illustrations, **not** a checklist — we're more interested in the questions you decide are worth
asking than in these:

- Which recurring jobs are auditors actually using the box for, and how much of the work is
  concentrated in the top few?
- Where does a session go wrong, and is it the tooling, the agent, or the request?
- Which failures are one-offs and which are systemic enough to be worth engineering time?
- What can you say about an auditor's working rhythm that would help someone planning an
  engagement?

## Deliverable

- Your tool, with instructions to run it.
- Sample output from the provided data.
- **One page maximum**: what you found, what you'd build next, what you deliberately left out.

## Time box

Aim for **4–6 hours**. We would much rather see something small and well-judged with an honest
"here's what I'd do with another week" than a sprawling half-finished framework. If you find
yourself building infrastructure instead of insight, stop and write that down instead.

## Questions

Ask them. Coming back with good questions about the data is a positive signal, not a negative
one.
