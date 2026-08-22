# Palette validation report — milestone A0

Required by `docs/plans/app.md` §6: chart color is computed, not eyeballed; the
categorical theme is finalized by the dataviz palette validator and checked in
next to the theme tokens (`app/src/theme.css`).

## Categorical series theme (fixed order, 7 slots)

`#3a6ea5` slate blue · `#80801f` olive · `#a8432f` brick · `#0f7d58` teal ·
`#b3822d` amber · `#1f81ab` steel cyan · `#b5643a` copper

Validator run (light surface `#ffffff`, mode `light`):

```
[PASS] Lightness band         all 7 inside L 0.43–0.77
[PASS] Chroma floor           all 7 >= 0.1
[WARN] CVD separation         worst adjacent #0f7d58↔#a8432f ΔE 6.1 (deutan) · tritan 12.7
[PASS] Normal-vision floor    worst adjacent #a8432f↔#80801f ΔE 17.1 (normal)
[PASS] Contrast vs surface    all 7 >= 3:1
→ ALL CHECKS PASS
```

The one WARN (brick↔teal adjacent pair, ΔE 6.1 deutan — inside the 6–8 floor
band) is legal only with secondary encoding; our mark specs make that encoding
mandatory everywhere the theme is used: 2px surface gaps between stacked
segments and adjacent bars, legends always present for ≥2 series, ≤4 series
direct-labeled, and the 45° hatch for uncertainty states. Slot order was chosen
to interleave hue families; alternates that removed the WARN failed harder
elsewhere (copper↔teal ΔE 3.8 protan — hard FAIL).

## Assignment rules

- Slots bind to entities in fixed dimension order (signature classes in
  `SignatureClassSchema` order; clients/tool families in `ref/dims` order) and
  are **never cycled or repainted** when filters change the series count.
- Status failure red (`#8e3b2f` muted brick) is a reserved token, distinct from
  categorical slot 3, and never used as a series color.
- Sequential (environments heatmap): one-hue slate ramp `--color-seq-1..6`,
  light→dark, monotonic lightness.
- Undetermined `#9aa4ad` grey (hatched) and unclassified `#c2c9cf` are legend
  colors in outcome views, never dropped residues.
- Dark mode is out of scope for v1 (app.md §6); the validator run repeats
  against the dark surface when that theme-token pass happens.
