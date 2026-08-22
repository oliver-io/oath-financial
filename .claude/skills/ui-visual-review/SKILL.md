---
name: ui-visual-review
description: Adversarial visual double-check of a UI screenshot against a stated intent, via the Gemini API. Use after building or changing any UI construct in this project — capture a screenshot, state what the view is SUPPOSED to show, and this skill sends both to Gemini for an adversarial prompt-fulfillment review with a structured pass/fail verdict. Use it to gate milestone claims ("A3 done") with a second pair of (machine) eyes.
user-invocable: true
---

# /ui-visual-review — Gemini visual double-check

A second, adversarial pair of eyes on UI work. You (the agent) have a known bias:
you believe the thing you just built matches the spec. This skill sends the
*rendered evidence* plus the *stated intent* to a different model (Gemini) whose
instruction is to **refute** the claim of fulfillment, and returns a structured
verdict.

`$ARGUMENTS`

## When to use

- After completing any `docs/plans/ui.md` construct or page — before declaring
  its milestone gate met (the app track's "render the result and look at it"
  verification step gets this as its machine half).
- After visual-affecting changes: theme/token edits, layout changes, new chart
  components, empty/degraded states.
- NOT for logic verification — this judges only what is visible in pixels.

## How to run

1. Capture a screenshot of the running UI (your concern — e.g. via the
   browser/devtools you already drive; full-page or construct-level crops both
   work, crops judge tighter).
2. Write the **stated intent**: what this view is supposed to show, as concrete,
   checkable claims. Pull the wording from `docs/plans/ui.md`'s construct spec —
   the named question, the required elements (captions, chips, hatching,
   legends), and the appearance rules that apply. Vague intents get vague
   reviews; enumerate.
3. Invoke:

```
bun .claude/skills/ui-visual-review/scripts/review.ts \
  --image path/to/shot.png \
  --intent "Ops failure page: stacked bar chart by signature class (≤7 muted colors, no purple), incident bands shaded, signature table sorted by sessions desc with class chips and 3-segment post-failure micro-bars, H/C/M provenance chips visible, no S chips, footer shows rule-table version" \
  --context "$(optional: paste the exact ui.md construct bullet + app.md §6 palette rules)"
```

Requires `GEMINI_API_KEY` in the environment (`GEMINI_MODEL` optionally
overrides the default `gemini-2.5-flash`). **No key → loud exit 2, never a
fabricated verdict.**

## Output contract

Structured JSON on stdout:
`{ reviewable, verdict: pass|fail, summary, mismatches: [{claim, observed, severity: blocker|major|minor}], visual_defects: [...] }`
— `visual_defects` catches breakage independent of the intent (clipping,
overflow, contrast, render failures), so an honest intent can't hide a broken
layout.

Exit codes gate mechanically: `0` pass · `1` fail (mismatches) · `2` usage/env ·
`3` API error · `4` unreviewable image or unparseable response.

## How to treat the verdict

- **The review is advisory adversarial input, not an oracle.** A `fail` means:
  read each mismatch, check it against the actual spec, and either fix the UI or
  — if Gemini misread the intent/image — record why the mismatch is wrong and
  proceed. Do not silently ignore a fail; do not blindly obey one either.
- A `blocker`/`major` mismatch that matches the spec text = fix before claiming
  the milestone. `minor` items are judgment calls; log them.
- `reviewable: false` or exit 3/4 = retake/retry, and if the API is unavailable,
  say so in your progress notes — an unreviewed milestone claim should mention
  that the visual double-check was skipped and why.
- Screenshots may be re-reviewed after fixes; include the previous mismatches in
  `--context` on the re-run so the reviewer checks the fixes specifically.

## Notes

- Fixture data in screenshots is expected (the app runs against
  `contracts/fixtures`) — intents should describe structure/affordances, not
  specific data values, unless the fixture values are themselves the point.
- Never send screenshots containing real client data to this tool (this
  project's dataset is synthetic, so the current fixtures are safe by
  construction).
