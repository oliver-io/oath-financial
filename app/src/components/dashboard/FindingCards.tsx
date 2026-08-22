// Ranked finding cards from ref/findings (rule-generated, never model prose).
// Rendered on the ROOM dashboards, filtered to the room's audience; audiences
// display as the README personas (OPERATIONS / PRODUCT).

import { parseIntArray, parseTargetParams } from "@trace-insights/contracts";
import { Link } from "react-router";
import { z } from "zod";
import { useData, useFilters, useRows } from "../../data/DataContext.tsx";
import { count } from "../../fmt.ts";
import { DEFAULT_FILTERS, type FilterState, filtersToSearch } from "../../state/urlState.ts";
import { ErrorState, ProvenanceChip, Skeleton } from "../shared/honesty.tsx";
import { Sparkline } from "../shared/microviz.tsx";

const FindingRowQ = z.object({
  finding_id: z.string(),
  rank: z.number(),
  audience: z.string(),
  title: z.string(),
  metric_value: z.number().nullable(),
  metric_label: z.string().nullable(),
  sparkline: z.string(),
  series_start_day: z.string().nullable(),
  target_params: z.string(),
  provenance: z.string(),
  requires_enrichment: z.boolean(),
});
type Finding = z.infer<typeof FindingRowQ>;

/** target_params (rule-emitted) → route + pre-set filters. */
function targetLink(f: Finding, base: FilterState): string {
  const p = parseTargetParams(f.target_params);
  const filters: FilterState = { ...DEFAULT_FILTERS, includeDemo: base.includeDemo };
  if (typeof p.from === "string" && typeof p.to === "string")
    filters.window = { fromDay: p.from, toDay: p.to };
  if (typeof p.signature === "string" && p.signature) filters.signature = p.signature;
  if (typeof p.gap === "string" && p.gap) filters.gap = p.gap;
  const path =
    p.side === "ops"
      ? "/ops/failures"
      : p.page === "usage"
        ? "/product/usage"
        : "/product/outcomes";
  return `${path}${filtersToSearch(filters)}`;
}

function AudienceTag({ audience }: { audience: string }) {
  const isOps = audience === "ops";
  return (
    <span
      className="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wider"
      style={{
        color: isOps ? "var(--color-ops)" : "var(--color-product)",
        background: isOps ? "var(--color-ops-soft)" : "var(--color-product-soft)",
      }}
    >
      {isOps ? "OPERATIONS" : "PRODUCT"}
    </span>
  );
}

const chipKind = (p: string): "heuristic" | "curated" | "model" | null =>
  p === "heuristic" || p === "curated" || p === "model" ? p : null;

export function FindingCards({ audience }: { audience: "ops" | "product" }) {
  const { degraded } = useData();
  const filters = useFilters();
  const findings = useRows(
    FindingRowQ,
    `SELECT * FROM findings WHERE audience = '${audience}' ORDER BY rank LIMIT 8`,
    null,
  );
  return (
    <section className="mb-8">
      {findings.error && <ErrorState message={findings.error} />}
      {findings.loading && <Skeleton lines={4} />}
      {findings.rows && findings.rows.length === 0 && (
        <div className="mb-4 rounded border border-hairline bg-paper p-4 text-sm text-ink-3">
          No {audience === "ops" ? "operations" : "product"} findings met their thresholds for
          this run.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:[&>div:last-child:nth-child(odd)]:col-span-2">
        {(findings.rows ?? []).map((f) => {
          const kind = chipKind(f.provenance);
          const spark = parseIntArray(f.sparkline);
          return (
            <div
              key={f.finding_id}
              className="flex items-center justify-between gap-4 rounded border border-hairline bg-surface p-3"
            >
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <AudienceTag audience={f.audience} />
                  {kind && (
                    <ProvenanceChip kind={kind} method="threshold rule over derived tables" />
                  )}
                </div>
                <p className="text-sm text-ink">{f.title}</p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                {spark.length > 0 ? (
                  <Sparkline values={spark} width={90} height={30} />
                ) : f.metric_value !== null ? (
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular text-ink">
                      {count(f.metric_value)}
                    </div>
                    <div className="text-[10px] text-ink-3">{f.metric_label}</div>
                  </div>
                ) : null}
                <Link
                  to={targetLink(f, filters)}
                  className="rounded border border-hairline px-2 py-1 text-xs font-medium text-ink-2 hover:border-ink-3"
                >
                  open →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
      {degraded.any && (
        <p className="mt-3 text-xs text-ink-3">
          Enrichment did not run for this publish — only rule-only findings are shown.
        </p>
      )}
    </section>
  );
}
