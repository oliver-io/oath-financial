# Where this data comes from

**The structure is real. The text is generated.** Worth understanding before you model it,
because it changes which findings mean something.

Our auditors work on per-client cloud workstations running Claude Code, and every turn emits a
Langfuse trace. We can't hand out those traces — they're full of client confidential material.
So we took the real telemetry and kept only its *shape*, then generated new content into it.

## Reused from real sessions, unchanged

- How sessions break into turns — **116 sessions, 763 turns**, from 1 turn to 76, median 3
- The **exact tool-call sequence** in every turn, and how observations nest under it
- **8,082 observations** with their real type mix (6,556 tool calls, 763 generations, 763 spans)
- The real distribution across **69 distinct tools** — `Bash` 3,166, browser automation 691,
  `Edit` 509, `Read` 330, `Agent` 307, …
- **Timing**: idle gaps between turns (median ~6 min, p90 ~2.3 h, longest spans days), and
  session length
- **Where failures happened** — a tool call that errored in the real session errors here, so the
  ~9% error rate and its clustering are real
- **Where sessions were killed by the platform** rather than finishing
- Token and cost values, and the telemetry quirks (see *Fields that will mislead you* in
  `SCHEMA.md`)
- The size distribution of user and assistant messages, including the bimodal user pattern —
  short typed asks alongside enormous machine-pasted payloads

## Generated fresh

- Every string. All prose, tool arguments, tool output, file paths, document names.
- All identities. **Harborline Capital**, **Vestamar Holdings**, **Quillbrook Ventures** and
  **Tealstone Demo** are invented, as are the auditors (`rowan`, `imani`, `teodor`, `marisol`,
  `ovie`, `sunniva`, `demo`) and every company, fund, LP, bank and firm named anywhere in it.
- All identifiers — trace ids, session ids, document ids, account numbers.
- All monetary amounts.

No real client text was pseudonymised, paraphrased or partially redacted to produce this. It was
discarded, and new content was written into the structure it left behind.

## What that means for your analysis

**Trust the structure. Be careful with the prose.**

- Findings grounded in **tool behaviour, sequencing, failure placement, session shape and
  timing** are grounded in real auditor work. That is where the signal is.
- Findings grounded in **specific wording** are measuring our text generator. The prose is
  template-based: it's coherent and on-topic per turn, but it does not have the variety of real
  human writing. If your approach depends on subtle phrasing, say so — and treat any conclusion
  from it as provisional.
- **The amounts are invented.** They're internally consistent within a turn (a tie-out that
  agrees will agree) but carry no real-world meaning. Arithmetic across turns is meaningless.
- Job types, error clustering and blocked sessions are faithful to the real data, so
  classification, friction detection and session-outcome work are all fair game — that's exactly
  what this dataset is for.

If a limitation of the data blocks something you wanted to do, write that down. Noticing it is
worth more to us than working around it silently.
