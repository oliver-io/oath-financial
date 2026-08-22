// Tool-sequence strip (ui.md §3 /session/:id): one colored block per call,
// color = family, red ring = counts-as-failure signature match; consecutive
// same-tool calls render as ONE block with an ×N badge (turns reach 131 calls
// — the compressed form is also the grind visualization). Block click →
// evidence popover with the rule that fired and the matched output snippet.

import type { ToolEventRow } from "@trace-insights/contracts";
import { useState } from "react";
import { toolFamilyColor } from "./series.ts";

export interface StripRun {
  tool: string;
  family: string;
  count: number;
  failures: ToolEventRow[]; // events in this run with failure_verdict rule/model_added
  uncertain: number;
  firstSeq: number;
}

/** Run-length compression by tool name (order preserved). */
export function compressRuns(events: ToolEventRow[]): StripRun[] {
  const runs: StripRun[] = [];
  for (const e of events) {
    const last = runs[runs.length - 1];
    const isFailure = e.failure_verdict === "rule" || e.failure_verdict === "model_added";
    const isUncertain = e.failure_verdict === "uncertain";
    if (last && last.tool === e.tool_name) {
      last.count += 1;
      if (isFailure) last.failures.push(e);
      if (isUncertain) last.uncertain += 1;
    } else {
      runs.push({
        tool: e.tool_name,
        family: e.tool_family,
        count: 1,
        failures: isFailure ? [e] : [],
        uncertain: isUncertain ? 1 : 0,
        firstSeq: e.seq_index,
      });
    }
  }
  return runs;
}

export function ToolStrip({
  events,
  signatureNames,
}: {
  events: ToolEventRow[];
  signatureNames: Map<string, string>;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const runs = compressRuns(events);
  if (runs.length === 0) return null;
  return (
    <div className="relative flex flex-wrap items-center gap-1">
      {runs.map((r) => {
        const failed = r.failures.length > 0;
        const isOpen = open === r.firstSeq;
        return (
          <span key={r.firstSeq} className="relative">
            <button
              type="button"
              title={`${r.tool}${r.count > 1 ? ` ×${r.count}` : ""}`}
              onClick={() => setOpen(isOpen ? null : r.firstSeq)}
              className="flex h-4 min-w-4 cursor-pointer items-center justify-center rounded-[3px] px-0.5 text-[9px] font-medium leading-none"
              style={{
                background: toolFamilyColor(r.family),
                color: "white",
                boxShadow: failed
                  ? "0 0 0 2px var(--color-surface), 0 0 0 3.5px var(--color-failure)"
                  : r.uncertain > 0
                    ? "0 0 0 2px var(--color-surface), 0 0 0 3.5px var(--color-undetermined)"
                    : "0 0 0 1px var(--color-surface)",
              }}
            >
              {r.count > 1 ? `×${r.count}` : ""}
            </button>
            {isOpen && (
              <div className="absolute left-0 top-6 z-30 w-80 rounded border border-hairline bg-surface p-2 text-xs shadow-md">
                <div className="font-mono text-[11px] text-ink">{r.tool}</div>
                <div className="text-ink-3">
                  {r.count} call{r.count === 1 ? "" : "s"} · family {r.family}
                  {r.uncertain > 0 && ` · ${r.uncertain} uncertain match(es)`}
                </div>
                {r.failures.length > 0 ? (
                  r.failures.slice(0, 3).map((f) => (
                    <div key={f.seq_index} className="mt-1.5 border-t border-hairline pt-1.5">
                      <div className="text-failure">
                        {f.matched_signature_id
                          ? (signatureNames.get(f.matched_signature_id) ?? f.matched_signature_id)
                          : "failure"}
                        <span className="ml-1 text-ink-3">
                          rule {f.matched_signature_id} @ {f.rule_version} · verdict{" "}
                          {f.failure_verdict}
                        </span>
                      </div>
                      {f.matched_snippet && (
                        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-paper p-1.5 font-mono text-[10px] text-ink-2">
                          {f.matched_snippet}
                        </pre>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="mt-1 text-ink-3">No counting failure matches in this run.</div>
                )}
              </div>
            )}
          </span>
        );
      })}
    </div>
  );
}
