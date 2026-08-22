// /ops/environments — "Which client box is unhealthy?" (ui.md §3): client ×
// signature-class heatmap, cell = errors per 100 tool calls (normalized);
// small-n cells (<200 calls) render dotted with a warning tooltip; cell click
// → /ops filtered. Plus the telemetry-integrity strip.

import { SignatureClassSchema } from "@trace-insights/contracts";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ErrorState, ProvenanceChip, Skeleton } from "../components/shared/honesty.tsx";
import { useData, useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import { EnvCellSchema, IntegritySchema, qEnvHeatmap, qIntegrity } from "../data/queries.ts";
import { count } from "../fmt.ts";
import { filtersToSearch } from "../state/urlState.ts";
import { EventSemanticsCaption, PageTitle, Section } from "./PageScaffold.tsx";

const SEQ = [
  "var(--color-seq-1)",
  "var(--color-seq-2)",
  "var(--color-seq-3)",
  "var(--color-seq-4)",
  "var(--color-seq-5)",
  "var(--color-seq-6)",
] as const;

export function OpsEnvironmentsPage() {
  const win = useWindow();
  const filters = useFilters();
  const navigate = useNavigate();
  const { manifest } = useData();
  const smallN = manifest.stated_params.small_n_call_threshold;
  const cells = useRows(EnvCellSchema, qEnvHeatmap(win, filters), win);
  const integrity = useRows(IntegritySchema, qIntegrity(filters), null);

  const { clients, rate, totals, maxRate } = useMemo(() => {
    const clientSet = [...new Set((cells.rows ?? []).map((c) => c.client))].sort();
    const totalsM = new Map<string, number>();
    const rateM = new Map<string, number>();
    let max = 0;
    for (const c of cells.rows ?? []) {
      totalsM.set(c.client, c.total_calls);
      if (c.signature_class) {
        const r = c.total_calls > 0 ? (c.failures / c.total_calls) * 100 : 0;
        rateM.set(`${c.client}|${c.signature_class}`, r);
        if (r > max) max = r;
      }
    }
    return { clients: clientSet, rate: rateM, totals: totalsM, maxRate: Math.max(max, 0.001) };
  }, [cells.rows]);

  const classes = SignatureClassSchema.options;
  const CELL = 46;

  return (
    <div>
      <PageTitle side="ops" title="Environments" question="Which client box is unhealthy?" />
      <Section
        title="Errors per 100 tool calls, client × failure class"
        chip={<ProvenanceChip kind="heuristic" method="counting signature matches normalized by call volume" />}
      >
        {cells.error && <ErrorState message={cells.error} />}
        {cells.loading && <Skeleton progress={cells.fetchProgress} />}
        {cells.rows && clients.length > 0 && (
          <svg width={230 + classes.length * (CELL + 2)} height={clients.length * (CELL + 2) + 90} className="max-w-full">
            <title>client × signature-class error-rate heatmap</title>
            {classes.map((cls, j) => (
              <text
                key={cls}
                x={170 + j * (CELL + 2) + CELL / 2}
                y={clients.length * (CELL + 2) + 14}
                fontSize={9}
                fill="var(--color-ink-3)"
                transform={`rotate(35, ${170 + j * (CELL + 2) + CELL / 2}, ${clients.length * (CELL + 2) + 14})`}
              >
                {cls}
              </text>
            ))}
            {clients.map((client, i) => {
              const total = totals.get(client) ?? 0;
              const small = total < smallN;
              return (
                <g key={client}>
                  <text x={164} y={i * (CELL + 2) + CELL / 2 + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-2)">
                    {client} <tspan fill="var(--color-ink-3)" fontSize={9}>({count(total)} calls)</tspan>
                  </text>
                  {classes.map((cls, j) => {
                    const r = rate.get(`${client}|${cls}`) ?? 0;
                    const step = r === 0 ? 0 : Math.min(5, 1 + Math.floor((r / maxRate) * 4.999));
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: SVG heatmap cell
                      <rect
                        key={cls}
                        x={170 + j * (CELL + 2)}
                        y={i * (CELL + 2)}
                        width={CELL}
                        height={CELL}
                        rx={3}
                        fill={small && r > 0 ? "url(#dot-small-n)" : SEQ[step]}
                        stroke={small && r > 0 ? "var(--color-ink-3)" : "none"}
                        strokeDasharray={small && r > 0 ? "2,2" : undefined}
                        className="cursor-pointer"
                        role="button"
                        onClick={() =>
                          navigate({
                            pathname: "/ops",
                            search: filtersToSearch({ ...filters, client }),
                          })
                        }
                      >
                        <title>
                          {small
                            ? `${client} × ${cls}: ${r.toFixed(1)} per 100 calls — fewer than ${smallN} calls; treat with caution`
                            : `${client} × ${cls}: ${r.toFixed(1)} errors per 100 calls — click to open /ops filtered`}
                        </title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}
        <p className="mt-1 text-[10px] text-ink-3">
          One-hue slate ramp, darker = higher rate. Dotted cells have under {smallN} calls in
          the window (small-n warning). Cell click opens /ops filtered to the client.
        </p>
        <EventSemanticsCaption />
      </Section>

      <Section title="Telemetry integrity — observability of the observability">
        {integrity.rows?.[0] && (
          <div className="flex flex-wrap gap-3">
            {(
              [
                ["resumed fragments (leading turns lost)", integrity.rows[0].resumed_fragments],
                ["sessions with internal missing turns", integrity.rows[0].sessions_missing_turns],
                ["sessions total", integrity.rows[0].sessions_total],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="rounded border border-hairline p-3 text-center">
                <div className="text-lg font-semibold tabular text-ink">{count(v)}</div>
                <div className="max-w-40 text-[10px] text-ink-3">{label}</div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] text-ink-3">
          Ingest-side integrity (generation rows missing usage, referential gates, fork
          checks) is recorded in the pipeline run manifest, which is not part of the serving
          plane — see the run stamp in the footer.
        </p>
      </Section>
    </div>
  );
}
