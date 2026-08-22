// The heart of /ops (ui.md §3): one row per failure signature — name · class
// chip · events · sessions · auditors · first/last seen · terminal-rate bar ·
// post-failure-shape micro-bar. Default sort sessions desc (systemic floats).
// Group-by toggle (none/client/auditor) re-pivots without a query builder.
// Row click expands: daily sparkline, sample matched outputs (verbatim, with
// the rule id that fired), affected-session links.

import type { FailureSignatureRow } from "@trace-insights/contracts";
import { parseIntArray } from "@trace-insights/contracts";
import { Fragment, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { z } from "zod";
import { useFilters, useRows, useWindow } from "../../data/DataContext.tsx";
import {
  DailyCountSchema,
  qSignatureDaily,
  qSignatureSamples,
  qSignatureSessions,
  SampleSnippetSchema,
  SessionLinkSchema,
  type SignatureAggSchema,
} from "../../data/queries.ts";
import { count, dayLabel, pct, tsLabel } from "../../fmt.ts";
import { ProvenanceChip } from "../shared/honesty.tsx";
import { MicroBar3, RateBar, Sparkline } from "../shared/microviz.tsx";
import { signatureClassColor } from "../shared/series.ts";
import { filtersToSearch } from "../../state/urlState.ts";

type Agg = z.infer<typeof SignatureAggSchema>;

function ClassChip({ cls }: { cls: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border border-hairline px-1 py-0.5 text-[10px] text-ink-2"
      title="curated taxonomy (versioned rule table)"
    >
      <span className="h-2 w-2 rounded-sm" style={{ background: signatureClassColor(cls) }} />
      {cls} <ProvenanceChip kind="curated" method="signatures.yaml taxonomy" />
    </span>
  );
}

function ExpandedRow({ patternId }: { patternId: string }) {
  const win = useWindow();
  const filters = useFilters();
  const daily = useRows(DailyCountSchema, qSignatureDaily(patternId, win, filters), win);
  const samples = useRows(SampleSnippetSchema, qSignatureSamples(patternId, win, filters), win);
  const sessions = useRows(SessionLinkSchema, qSignatureSessions(patternId, win, filters), win);
  return (
    <div className="grid grid-cols-1 gap-4 bg-paper px-4 py-3 md:grid-cols-3">
      <div>
        <div className="mb-1 text-[11px] font-medium text-ink-2">Daily events in window</div>
        {daily.rows && daily.rows.length > 0 ? (
          <Sparkline values={daily.rows.map((d) => d.n)} width={180} height={32} />
        ) : (
          <span className="text-xs text-ink-3">no events in window</span>
        )}
      </div>
      <div>
        <div className="mb-1 text-[11px] font-medium text-ink-2">
          Sample matched outputs (verbatim)
        </div>
        {(samples.rows ?? []).map((s) => (
          <pre
            key={s.matched_snippet}
            className="mb-1 max-h-20 overflow-auto whitespace-pre-wrap rounded border border-hairline bg-surface p-1.5 font-mono text-[10px] text-ink-2"
          >
            {s.matched_snippet}
          </pre>
        ))}
        <div className="text-[10px] text-ink-3">
          rule {patternId} @ {samples.rows?.[0]?.rule_version ?? "—"}
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-medium text-ink-2">Affected sessions</div>
        <div className="flex flex-wrap gap-1">
          {(sessions.rows ?? []).map((s) => (
            <Link
              key={s.session_id}
              to={`/session/${s.session_id}`}
              className="rounded border border-hairline bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-2 hover:border-ink-3"
              title={`${s.auditor} · ${s.client} · ${s.n} events`}
            >
              {s.session_id}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SignatureTable({
  aggs,
  refByPattern,
  groupBy,
}: {
  aggs: Agg[];
  refByPattern: Map<string, FailureSignatureRow>;
  groupBy: "none" | "client" | "auditor";
}) {
  const filters = useFilters();
  const navigate = useNavigate();
  const location = useLocation();
  const [expanded, setExpanded] = useState<string | null>(filters.signature);

  const setGroup = (g: "none" | "client" | "auditor") =>
    navigate({
      pathname: location.pathname,
      search: filtersToSearch({ ...filters, groupBy: g }),
    });

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-ink-2">
        <span>group by</span>
        {(["none", "client", "auditor"] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroup(g)}
            className="cursor-pointer rounded border px-1.5 py-0.5"
            style={
              groupBy === g
                ? { borderColor: "var(--color-ops)", color: "var(--color-ops)", fontWeight: 500 }
                : { borderColor: "var(--color-hairline)" }
            }
          >
            {g}
          </button>
        ))}
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-hairline text-left text-[11px] text-ink-3">
            <th className="py-1.5 pr-2 font-medium">signature</th>
            {groupBy !== "none" && <th className="py-1.5 pr-2 font-medium">{groupBy}</th>}
            <th className="py-1.5 pr-2 font-medium">class</th>
            <th className="py-1.5 pr-2 text-right font-medium" title="heuristic count of matches in window">
              events
            </th>
            <th className="py-1.5 pr-2 text-right font-medium">sessions</th>
            <th className="py-1.5 pr-2 text-right font-medium">auditors</th>
            <th className="py-1.5 pr-2 font-medium">first / last seen</th>
            <th className="py-1.5 pr-2 font-medium" title="share of occurrences in a session's final turn — a co-occurrence rate, not a kill claim">
              terminal
            </th>
            <th className="py-1.5 font-medium" title="structural post-failure shape: same-tool-clean-later / other-calls-after / turn-ends-on-failure">
              post-failure shape
            </th>
          </tr>
        </thead>
        <tbody className="tabular">
          {aggs.map((a) => {
            const ref = refByPattern.get(a.pattern_id);
            const key = `${a.pattern_id}|${a.group_value ?? ""}`;
            const isSelected = filters.signature === a.pattern_id;
            const isExpanded = expanded === key || (isSelected && expanded === a.pattern_id);
            return (
              <Fragment key={key}>
                <tr
                  className="cursor-pointer border-b border-hairline hover:bg-paper"
                  style={isSelected ? { background: "var(--color-ops-soft)" } : undefined}
                  onClick={() => setExpanded(isExpanded ? null : key)}
                >
                  <td className="py-2 pr-2">
                    <span className="font-medium text-ink">
                      {ref?.display_name ?? a.pattern_id}
                    </span>{" "}
                    <ProvenanceChip kind="heuristic" method="anchored signature match" />
                    {ref?.counts_as_failure === "uncertain" && (
                      <span className="ml-1 text-[10px] text-ink-3" title="curated: a match may not be a failure; gray-zone events adjudicated by J1 where enrichment ran">
                        uncertain-class
                      </span>
                    )}
                    {ref?.j5_false_positive_rate !== null && ref?.j5_false_positive_rate !== undefined && (
                      <span className="ml-1 text-[10px] text-ink-3" title="J5 audit estimate of this rule's error bars">
                        ±{pct(ref.j5_false_positive_rate)} FP{" "}
                        <ProvenanceChip kind="model" method="J5 heuristic audit sample" />
                      </span>
                    )}
                  </td>
                  {groupBy !== "none" && <td className="py-2 pr-2">{a.group_value}</td>}
                  <td className="py-2 pr-2">{ref ? <ClassChip cls={ref.signature_class} /> : "—"}</td>
                  <td className="py-2 pr-2 text-right">{count(a.events)}</td>
                  <td className="py-2 pr-2 text-right font-medium">{count(a.sessions)}</td>
                  <td className="py-2 pr-2 text-right">{count(a.auditors)}</td>
                  <td className="py-2 pr-2 text-[10px] text-ink-3">
                    {a.first_seen_w ? tsLabel(a.first_seen_w) : "—"} –{" "}
                    {a.last_seen_w ? tsLabel(a.last_seen_w) : "—"}
                  </td>
                  <td className="py-2 pr-2">
                    {ref?.terminal_rate !== null && ref?.terminal_rate !== undefined ? (
                      <span title={`${pct(ref.terminal_rate)} of occurrences in a final turn (full dataset)`}>
                        <RateBar value={ref.terminal_rate} />{" "}
                        <ProvenanceChip kind="heuristic" />
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2">
                    <MicroBar3 a={a.shape_a} b={a.shape_b} c={a.shape_c} />
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-hairline">
                    <td colSpan={groupBy !== "none" ? 9 : 8} className="p-0">
                      <ExpandedRow patternId={a.pattern_id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {aggs.length === 0 && (
        <div className="py-4 text-sm text-ink-3">No signature matches in this window.</div>
      )}
    </div>
  );
}
