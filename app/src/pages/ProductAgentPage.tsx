// /product/agent — "Where does the agent thrash, retry, or get corrected?"
// (ui.md §3). Turn/event-grain, counts are facts, names are judgments:
// no "thrash"/"grind" labels on the structural columns.

import { useState } from "react";
import { Link } from "react-router";
import {
  ErrorState,
  ProvenanceChip,
  Skeleton,
  StatedParam,
} from "../components/shared/honesty.tsx";
import { MicroBar3 } from "../components/shared/microviz.tsx";
import { toolFamilyColor } from "../components/shared/series.ts";
import { useData, useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import {
  CorrectionRowSchema,
  FamilyShapeSchema,
  GrindRowSchema,
  qCorrections,
  qGrindTurns,
  qPostFailureByFamily,
  qRepeatChains,
  RepeatChainRowSchema,
} from "../data/queries.ts";
import { count, dayLabel } from "../fmt.ts";
import { EventSemanticsCaption, PageTitle, Section } from "./PageScaffold.tsx";

function SessionLink({ sessionId, turn }: { sessionId: string; turn: number }) {
  return (
    <Link
      to={`/session/${sessionId}`}
      className="font-mono text-[11px] underline decoration-dotted"
    >
      {sessionId}
      <span className="text-ink-3">#{turn}</span>
    </Link>
  );
}

function CorrectionItem({
  row,
}: {
  row: {
    session_id: string;
    turn_number: number;
    day: string;
    user_text_head: string;
    prev_assistant_tail: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hairline py-2">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-3">
        <SessionLink sessionId={row.session_id} turn={row.turn_number} />
        <span>{dayLabel(row.day)}</span>
        <button
          type="button"
          className="cursor-pointer underline decoration-dotted"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "hide" : "show"} previous assistant tail
        </button>
      </div>
      <p className="text-xs text-ink">{row.user_text_head}…</p>
      {open && (
        <pre className="mt-1 whitespace-pre-wrap rounded bg-paper p-2 font-mono text-[10px] text-ink-2">
          {row.prev_assistant_tail ?? "(no previous turn in window)"}
        </pre>
      )}
    </div>
  );
}

export function ProductAgentPage() {
  const win = useWindow();
  const filters = useFilters();
  const { manifest, degraded } = useData();
  const threshold = manifest.stated_params.grind_run_threshold;
  const chains = useRows(RepeatChainRowSchema, qRepeatChains(win, filters), win);
  const grinds = useRows(GrindRowSchema, qGrindTurns(win, filters, threshold), win);
  const corrections = useRows(CorrectionRowSchema, qCorrections(win, filters), win);
  const shapes = useRows(FamilyShapeSchema, qPostFailureByFamily(win, filters), win);

  return (
    <div>
      <PageTitle
        side="product"
        title="Agent behavior"
        question="Where does the agent thrash, retry, or get corrected?"
      />
      <EventSemanticsCaption />

      <Section title="Byte-identical re-invocations — repeat chains per turn">
        {chains.error && <ErrorState message={chains.error} />}
        {chains.loading && <Skeleton progress={chains.fetchProgress} />}
        {chains.rows && chains.rows.length > 0 ? (
          <table className="w-full max-w-2xl border-collapse text-xs tabular">
            <thead>
              <tr className="border-b border-hairline text-left text-[11px] text-ink-3">
                <th className="py-1.5 pr-2 font-medium">turn</th>
                <th className="py-1.5 pr-2 font-medium">tool(s)</th>
                <th className="py-1.5 pr-2 text-right font-medium">chain length</th>
                <th className="py-1.5 font-medium">followed a signature match?</th>
              </tr>
            </thead>
            <tbody>
              {chains.rows.map((r) => (
                <tr
                  key={`${r.session_id}|${r.turn_number}`}
                  className="border-b border-hairline hover:bg-paper"
                >
                  <td className="py-1.5 pr-2">
                    <SessionLink sessionId={r.session_id} turn={r.turn_number} />
                  </td>
                  <td className="py-1.5 pr-2 font-mono text-[10px]">{r.tools}</td>
                  <td className="py-1.5 pr-2 text-right font-medium">{count(r.chain_count)}</td>
                  <td className="py-1.5">{r.after_signature_match ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !chains.loading && (
            <p className="text-sm text-ink-3">No identical-input chains in this window.</p>
          )
        )}
        <p className="mt-1 text-[10px] text-ink-3">
          Identical re-invocation is the fact; whether it is a retry is interpretation (polling
          loops repeat inputs legitimately) — no judgment column without enrichment.
        </p>
      </Section>

      <Section
        title="Long same-tool runs per turn"
        chip={
          <StatedParam
            label="run threshold"
            value={String(threshold)}
            rationale="Turns whose longest single-tool run meets this length. A neutral count — a 75-call Bash run may be a legitimate batch loop; the 'grind' reading is interpretation."
          />
        }
      >
        {grinds.loading && <Skeleton progress={grinds.fetchProgress} />}
        {grinds.rows && grinds.rows.length > 0 ? (
          <table className="w-full max-w-xl border-collapse text-xs tabular">
            <thead>
              <tr className="border-b border-hairline text-left text-[11px] text-ink-3">
                <th className="py-1.5 pr-2 font-medium">turn</th>
                <th className="py-1.5 pr-2 font-medium">dominant family (by call count)</th>
                <th className="py-1.5 text-right font-medium">longest run</th>
              </tr>
            </thead>
            <tbody>
              {grinds.rows.map((r) => (
                <tr
                  key={`${r.session_id}|${r.turn_number}`}
                  className="border-b border-hairline hover:bg-paper"
                >
                  <td className="py-1.5 pr-2">
                    <SessionLink sessionId={r.session_id} turn={r.turn_number} />
                  </td>
                  <td className="py-1.5 pr-2">
                    {r.dominant_family && (
                      <>
                        <span
                          className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                          style={{ background: toolFamilyColor(r.dominant_family) }}
                        />
                        {r.dominant_family}
                        {r.dominant_family === "browser" && (
                          <Link
                            to={{ pathname: "/product/outcomes", search: "" }}
                            className="ml-2 text-[10px] underline decoration-dotted"
                            title="browser-family runs concentrate in the browser-grind capability gap — see the gap ledger"
                          >
                            ↘ capability gap
                          </Link>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-medium">×{count(r.max_same_tool_run)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !grinds.loading && (
            <p className="text-sm text-ink-3">No runs at or above the threshold in this window.</p>
          )
        )}
      </Section>

      <Section
        title="Correction feed — where the user re-steered"
        chip={
          <ProvenanceChip
            kind="model"
            method="J2 correction classification over flagged candidate turns"
          />
        }
      >
        {degraded.j2 && (
          <p className="mb-2 text-xs text-ink-3">
            Enrichment did not run — corrections are unclassified this run (the deterministic
            candidate flag alone mixes real re-steers with plain new asks).
          </p>
        )}
        {corrections.loading && <Skeleton progress={corrections.fetchProgress} />}
        <div className="max-w-2xl">
          {(corrections.rows ?? []).map((r) => (
            <CorrectionItem key={`${r.session_id}|${r.turn_number}`} row={r} />
          ))}
          {corrections.rows?.length === 0 && !degraded.j2 && (
            <p className="text-sm text-ink-3">No classified corrections in this window.</p>
          )}
        </div>
        <p className="mt-1 text-[10px] text-ink-3">A curated review queue, not a metric.</p>
      </Section>

      <Section title="What happens after a failure, by tool family — structural only">
        {shapes.loading && <Skeleton progress={shapes.fetchProgress} />}
        <div className="max-w-md">
          {(shapes.rows ?? []).map((r) => (
            <div key={r.tool_family} className="mb-1 flex items-center gap-2 text-xs">
              <span className="w-24 text-right text-ink-2">{r.tool_family}</span>
              <MicroBar3 a={r.shape_a} b={r.shape_b} c={r.shape_c} width={200} />
              <span className="tabular text-[10px] text-ink-3">
                {count(r.shape_a + r.shape_b + r.shape_c)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-ink-3">
          Segments: same-tool-clean-later / other-calls-after / turn-ends-on-failure. Positional
          facts — recovery claims are model-class and deliberately absent here.
        </p>
      </Section>
    </div>
  );
}
