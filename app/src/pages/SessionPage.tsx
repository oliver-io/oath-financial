// /session/:id — the shared drill-down terminus and trust-builder (ui.md §3).
// Header chips with evidence popovers; vertical turn timeline with log-scaled
// gap spacers, marker badges, run-length tool strips, platform-limit banners.

import type { SessionRow, TurnRow } from "@trace-insights/contracts";
import { parseIntArray } from "@trace-insights/contracts";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { CollapsibleText } from "../components/shared/CollapsibleText.tsx";
import {
  CaptionBar,
  EmptyState,
  ErrorState,
  ProvenanceChip,
  Skeleton,
} from "../components/shared/honesty.tsx";
import { ToolStrip } from "../components/shared/ToolStrip.tsx";
import { useData, useRows } from "../data/DataContext.tsx";
import {
  FailureSignatureRowQ,
  qFailureSignatures,
  qSession,
  qSessionToolEvents,
  qSessionTurns,
  SessionRowQ,
  ToolEventRowQ,
  TurnRowQ,
} from "../data/queries.ts";
import { chars, count, duration, tsLabel } from "../fmt.ts";

function Chip({ label, tone }: { label: string; tone?: "warn" | "demo" }) {
  return (
    <span
      className="rounded-sm border px-1.5 py-0.5 text-[11px]"
      style={
        tone === "warn"
          ? { borderColor: "var(--color-failure)", color: "var(--color-failure)" }
          : { borderColor: "var(--color-hairline)", color: "var(--color-ink-2)" }
      }
    >
      {label}
    </span>
  );
}

function EvidenceChip({
  label,
  evidence,
  method,
}: {
  label: string;
  evidence: string | null;
  method: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        type="button"
        className="cursor-pointer rounded-sm border border-hairline px-1.5 py-0.5 text-[11px] text-ink"
        onClick={() => setOpen((v) => !v)}
      >
        {label} <ProvenanceChip kind="model" method={method} />
      </button>
      {open && (
        <span className="absolute left-0 top-6 z-30 block w-72 rounded border border-hairline bg-surface p-2 text-xs text-ink-2 shadow-md">
          {evidence ?? "No evidence recorded."}
        </span>
      )}
    </span>
  );
}

function GapSpacer({ seconds }: { seconds: number }) {
  // log-scaled height; >2h gaps visually distinct
  const h = Math.min(64, 8 + Math.log10(1 + seconds) * 10);
  const big = seconds > 7200;
  return (
    <div className="flex items-center gap-2 pl-10" style={{ height: h }}>
      <div
        className="h-full w-px"
        style={{
          background: big ? "var(--color-ink-3)" : "var(--color-hairline)",
          borderLeft: big ? "1px dashed var(--color-ink-3)" : undefined,
        }}
      />
      <span className={`text-[10px] ${big ? "font-medium text-ink-2" : "text-ink-3"}`}>
        {duration(seconds)} gap
      </span>
    </div>
  );
}

function TurnBlock({
  turn,
  events,
  signatureNames,
}: {
  turn: TurnRow;
  events: Parameters<typeof ToolStrip>[0]["events"];
  signatureNames: Map<string, string>;
}) {
  return (
    <div className="flex gap-3">
      <div className="w-8 shrink-0 pt-1 text-right text-[11px] tabular text-ink-3">
        {turn.turn_number}
      </div>
      <div className="min-w-0 flex-1 border-l border-hairline pl-3 pb-1">
        {turn.platform_limit_marker && (
          <div className="mb-1 rounded border border-hairline bg-failure-soft px-2 py-1 text-[11px] text-ink-2">
            Org monthly spend-limit message appears in this turn's output{" "}
            <ProvenanceChip
              kind="heuristic"
              method="deterministic marker; whether it ended the session is interpretation"
            />
          </div>
        )}
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-3">
          <span className="tabular">{tsLabel(turn.ts)}</span>
          {turn.has_task_notification && <Chip label="task-notification" />}
          {turn.has_skill_body && <Chip label="skill-body" />}
          {turn.has_extract_paste && <Chip label="extract-paste" />}
          {turn.typed_prefix_chars > 0 && (
            <span title="human-authored portion before the first marker (heuristic)">
              typed {chars(turn.typed_prefix_chars)} <ProvenanceChip kind="heuristic" />
            </span>
          )}
          {turn.is_correction === true && <Chip label="correction" tone="warn" />}
        </div>
        {turn.user_text.length > 0 && <CollapsibleText text={turn.user_text} tone="user" />}
        {events.length > 0 && (
          <div className="my-1.5">
            <ToolStrip events={events} signatureNames={signatureNames} />
          </div>
        )}
        {turn.assistant_text.length > 0 && (
          <CollapsibleText text={turn.assistant_text} limit={400} tone="assistant" />
        )}
      </div>
    </div>
  );
}

export function SessionPage() {
  const { id } = useParams();
  const sessionId = id ?? "";
  const { degraded } = useData();
  const sessionQ = useRows(SessionRowQ, sessionId ? qSession(sessionId) : null, null);
  const session: SessionRow | undefined = sessionQ.rows?.[0];
  const win = session
    ? { fromDay: session.first_ts.slice(0, 10), toDay: session.last_ts.slice(0, 10) }
    : null;
  const turnsQ = useRows(TurnRowQ, session ? qSessionTurns(sessionId) : null, win);
  const eventsQ = useRows(ToolEventRowQ, session ? qSessionToolEvents(sessionId) : null, win);
  const sigsQ = useRows(FailureSignatureRowQ, qFailureSignatures(), null);
  const signatureNames = useMemo(
    () => new Map((sigsQ.rows ?? []).map((s) => [s.pattern_id, s.display_name])),
    [sigsQ.rows],
  );
  const eventsByTurn = useMemo(() => {
    const m = new Map<number, NonNullable<typeof eventsQ.rows>>();
    for (const e of eventsQ.rows ?? []) {
      const arr = m.get(e.turn_number) ?? [];
      arr.push(e);
      m.set(e.turn_number, arr);
    }
    return m;
  }, [eventsQ.rows]);

  if (sessionQ.error) return <ErrorState message={sessionQ.error} />;
  if (sessionQ.loading) return <Skeleton lines={4} />;
  if (!session)
    return <EmptyState>No session with id "{sessionId}" exists in this run.</EmptyState>;

  const missing = parseIntArray(session.missing_turns);
  return (
    <div className="max-w-4xl">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">
          Session <span className="font-mono text-base">{session.session_id}</span>
        </h1>
        {session.is_demo_traffic && <Chip label="demo traffic" tone="demo" />}
        {session.resumed_fragment && (
          <Chip label="resumed fragment — leading turns lost by telemetry" tone="warn" />
        )}
        {missing.length > 0 && <Chip label={`missing turns ${missing.join(", ")}`} tone="warn" />}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        <span>
          {session.client} / {session.entity}
        </span>
        <span>{session.auditor}</span>
        <span className="tabular">
          {tsLabel(session.first_ts)} → {tsLabel(session.last_ts)}
        </span>
        <span className="tabular">{count(session.turn_count)} turns</span>
        <span className="tabular" title="display-only; wall span is never presented as effort">
          wall span {duration(session.wall_span_s)}
        </span>
        <span className="tabular">
          engaged {duration(session.capped_gap_span_s, true)}{" "}
          <ProvenanceChip kind="heuristic" method="sum of inter-turn gaps under the stated cap" />
        </span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {session.job_type ? (
          <EvidenceChip
            label={`job: ${session.job_type}`}
            evidence="J3 session classification; taxonomy is provisional."
            method="J3 session classification"
          />
        ) : (
          <Chip
            label={degraded.j3 ? "job type: not classified (enrichment not run)" : "job type: —"}
          />
        )}
        {session.outcome ? (
          <EvidenceChip
            label={`outcome: ${session.outcome}`}
            evidence={session.outcome_evidence}
            method="J3 session classification; undetermined is a first-class bucket"
          />
        ) : (
          <Chip
            label={degraded.j3 ? "outcome: not classified (enrichment not run)" : "outcome: —"}
          />
        )}
      </div>
      {(turnsQ.loading || eventsQ.loading) && (
        <Skeleton lines={6} progress={turnsQ.fetchProgress} />
      )}
      {turnsQ.error && <ErrorState message={turnsQ.error} />}
      {turnsQ.rows && (
        <div>
          {turnsQ.rows.map((t, i) => (
            <div key={t.turn_number}>
              {i > 0 && t.gap_before_s !== null && t.gap_before_s > 0 && (
                <GapSpacer seconds={t.gap_before_s} />
              )}
              <TurnBlock
                turn={t}
                events={eventsByTurn.get(t.turn_number) ?? []}
                signatureNames={signatureNames}
              />
            </div>
          ))}
          <CaptionBar>
            <span>
              Tool strips are run-length compressed: a ×N block is N consecutive calls of one tool.
              Red ring = counts-as-failure signature match; grey ring = uncertain match.
            </span>
          </CaptionBar>
        </div>
      )}
    </div>
  );
}
