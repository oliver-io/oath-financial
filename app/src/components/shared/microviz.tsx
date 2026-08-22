// Micro-viz shared components (app.md §1): sparklines and 3-segment micro-bars
// sit inside table cells at text height. Direct SVG control keeps the honesty
// affordances (hatching, dotted small-n, ×N) enforceable.

export function Sparkline({
  values,
  width = 96,
  height = 20,
  color = "var(--color-ink-2)",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const step = width / Math.max(values.length - 1, 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      className="inline-block align-middle"
      role="img"
      aria-label="trend sparkline"
    >
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** 3-segment horizontal micro-bar for post_failure_shape distributions
 * (structural counts; semantic recovery labels are model-class and absent
 * here). 2px surface gaps between segments per the mark spec. */
export function MicroBar3({
  a,
  b,
  c,
  width = 90,
  title,
}: {
  a: number; // same_tool_clean_later
  b: number; // other_calls_after
  c: number; // turn_ends_on_failure
  width?: number;
  title?: string;
}) {
  const total = a + b + c;
  if (total === 0) return <span className="text-xs text-ink-3">—</span>;
  const seg = (v: number) => Math.round((v / total) * (width - 4));
  const wa = seg(a);
  const wb = seg(b);
  const wc = Math.max(0, width - 4 - wa - wb);
  const colors = ["var(--color-series-4)", "var(--color-series-5)", "var(--color-failure)"];
  let x = 0;
  const rects = [wa, wb, wc].map((w, i) => {
    const r = (
      <rect key={colors[i]} x={x} y={3} width={Math.max(w, 0)} height={8} rx={2} fill={colors[i]} />
    );
    x += w + 2;
    return r;
  });
  return (
    <svg width={width} height={14} className="inline-block align-middle" role="img">
      <title>
        {title ??
          `post-failure shape: ${a} same-tool-clean-later / ${b} other-calls-after / ${c} turn-ends-on-failure`}
      </title>
      {rects}
    </svg>
  );
}

/** Simple horizontal rate bar (0..1) for terminal-rate cells. */
export function RateBar({ value, width = 64 }: { value: number; width?: number }) {
  return (
    <svg width={width} height={10} className="inline-block align-middle" role="img">
      <title>{`${Math.round(value * 100)}%`}</title>
      <rect x="0" y="2" width={width} height={6} rx={2} fill="var(--color-grid)" />
      <rect
        x="0"
        y="2"
        width={Math.max(2, value * width)}
        height={6}
        rx={2}
        fill="var(--color-ink-3)"
      />
    </svg>
  );
}
