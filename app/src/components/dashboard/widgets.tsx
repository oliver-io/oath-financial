// The PANEL REGISTRY (user directive): every construct is a panel with a
// full DETAIL view (rendered on its page via <PanelSection>) and a WIDGET
// view (a summary for the dashboard — or the detail itself where a construct
// can't be summarized). Pinning happens on the page; the dashboard tile's
// title links back to the anchored detail. One title per panel, used in both
// places, so names can never diverge.

import type { ReactNode } from "react";
import { Link } from "react-router";
import { useData, useFilters, useRows, useWindow } from "../../data/DataContext.tsx";
import {
  AuthOverheadSchema,
  DashboardStatsSchema,
  qAuthOverhead,
  qDashboardStats,
} from "../../data/queries.ts";
import { count, duration } from "../../fmt.ts";
import type { Side } from "../../state/pins.ts";
import { DEFAULT_FILTERS, filtersToSearch } from "../../state/urlState.ts";
import {
  ActivityStripsPanel,
  BoutProfilePanel,
  EnvHeatmapPanel,
  FailureSeriesPanel,
  IntegrityStripPanel,
  QuickRestartsPanel,
  SignatureTablePanel,
  SignatureTableWidget,
  SpanScatterPanel,
} from "../ops/panels.tsx";
import {
  AuditorClientGridPanel,
  CorrectionFeedPanel,
  FamilyAdoptionPanel,
  FamilyShapesPanel,
  FrictionTablePanel,
  GapLedgerPanel,
  GrindTablePanel,
  GrindThresholdParam,
  InteractionStripPanel,
  JobSharePanel,
  LobTimelinePanel,
  OutcomeBarsPanel,
  RepeatChainsPanel,
} from "../product/panels.tsx";
import { ProvenanceChip, Skeleton, StatedParam } from "../shared/honesty.tsx";

export interface WidgetDef {
  id: string;
  side: Side;
  /** The one name: section title on the page AND tile title on the board. */
  title: string;
  /** The page carrying the detail view; tiles link to `source#panel-<id>`. */
  source: string;
  /** Widget sizing: stat tiles pack, half pair up, full take the row. */
  size: "stat" | "half" | "full";
  /** Provenance chips / ⚙ stated params shown beside the title. */
  chip?: () => ReactNode;
  /** The full construct, rendered on its page. */
  detail: () => ReactNode;
  /** The dashboard summary; omitted = the detail renders on the board too. */
  widget?: () => ReactNode;
}

// ---- shared chrome bits -----------------------------------------------------

function GapCapParam() {
  const { manifest } = useData();
  return (
    <StatedParam
      label="gap cap"
      value={duration(manifest.stated_params.gap_cap_s)}
      rationale="Inter-turn gaps above this cap are treated as absence: they end a bout and are excluded from engaged-time sums. Some sub-cap gaps contain agent background work, so 'engaged' still overclaims slightly."
    />
  );
}

function QuickRestartParam() {
  const { manifest } = useData();
  return (
    <StatedParam
      label="quick-restart window"
      value={duration(manifest.stated_params.quick_restart_window_s)}
      rationale="A new session by the same auditor within this window of the previous one. Explicitly NOT a continuation claim — the next session is presumed a distinct task."
    />
  );
}

// ---- stat renderers ---------------------------------------------------------

function StatWidget({
  pick,
  label,
  caption,
}: {
  pick: (s: {
    failure_events: number;
    active_clients: number;
    active_auditors: number;
    turns: number;
    determined: number;
    contained: number;
    chain_turns: number;
  }) => string;
  label: string;
  caption: string;
}) {
  const win = useWindow();
  const filters = useFilters();
  const stats = useRows(DashboardStatsSchema, qDashboardStats(win, filters), win);
  const s = stats.rows?.[0];
  if (stats.loading) return <Skeleton lines={2} />;
  return (
    <div>
      <div className="text-2xl font-semibold tabular text-ink">{s ? pick(s) : "—"}</div>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="mt-1 text-[10px] text-ink-3">{caption}</div>
    </div>
  );
}

/** Auth overhead: sessions touched by portal-auth failures, with the ops
 * crossover chip (ui.md §4 — always a visible chip, never a merged view). */
function AuthOverheadWidget() {
  const win = useWindow();
  const filters = useFilters();
  const auth = useRows(AuthOverheadSchema, qAuthOverhead(win, filters), win);
  if (auth.loading) return <Skeleton lines={2} />;
  const touched = auth.rows?.[0]?.touched ?? null;
  return (
    <div>
      <div className="text-2xl font-semibold tabular text-ink">
        {touched !== null ? count(touched) : "—"}
      </div>
      <div className="text-[11px] text-ink-3">sessions touched by portal-auth failures</div>
      <div className="mt-1 text-[10px] text-ink-3">event-timestamp membership</div>
      <Link
        to={{
          pathname: "/ops/failures",
          search: filtersToSearch({
            ...DEFAULT_FILTERS,
            window: filters.window,
            signature: "portal-auth-403",
          }),
          hash: "#panel-signature-table",
        }}
        className="mt-1.5 inline-block rounded border px-1.5 py-0.5 text-[10px]"
        style={{ borderColor: "var(--color-ops)", color: "var(--color-ops)" }}
        title="the failure entity behind this overhead — auth is infra friction, not work"
      >
        ↗ portal-auth-403 in Ops
      </Link>
    </div>
  );
}

// ---- the registry -----------------------------------------------------------

export const WIDGETS: WidgetDef[] = [
  // ------------------------------------------------------------------- ops
  {
    id: "failure-series",
    side: "ops",
    title: "When is it failing, and what kind?",
    source: "/ops/failures",
    size: "full",
    chip: () => <ProvenanceChip kind="heuristic" method="anchored signature matches per day" />,
    detail: () => <FailureSeriesPanel />,
  },
  {
    id: "signature-table",
    side: "ops",
    title: "Failure signatures",
    source: "/ops/failures",
    size: "half",
    detail: () => <SignatureTablePanel />,
    widget: () => <SignatureTableWidget />,
  },
  {
    id: "env-heatmap",
    side: "ops",
    title: "Errors per 100 tool calls, client × failure class",
    source: "/ops/environments",
    size: "half",
    chip: () => (
      <ProvenanceChip
        kind="heuristic"
        method="counting signature matches normalized by call volume"
      />
    ),
    detail: () => <EnvHeatmapPanel />,
  },
  {
    id: "telemetry-integrity",
    side: "ops",
    title: "Telemetry integrity — completeness of the trace record",
    source: "/ops/environments",
    size: "half",
    detail: () => <IntegrityStripPanel />,
  },
  {
    id: "activity-strips",
    side: "ops",
    title: "Who was active when",
    source: "/ops/rhythm",
    size: "half",
    chip: () => <GapCapParam />,
    detail: () => <ActivityStripsPanel />,
    widget: () => <ActivityStripsPanel compact />,
  },
  {
    id: "bout-profile",
    side: "ops",
    title: "Bout profile — work stretches per day and typical length",
    source: "/ops/rhythm",
    size: "half",
    chip: () => (
      <>
        <ProvenanceChip
          kind="heuristic"
          method="bouts segmented at the stated gap cap on the auditor's merged timeline"
        />{" "}
        <GapCapParam />
      </>
    ),
    detail: () => <BoutProfilePanel />,
  },
  {
    id: "span-scatter",
    side: "ops",
    title: "Wall span vs engaged time",
    source: "/ops/rhythm",
    size: "half",
    chip: () => (
      <>
        <ProvenanceChip kind="heuristic" method="engaged = capped-gap span" /> <GapCapParam />
      </>
    ),
    detail: () => <SpanScatterPanel />,
  },
  {
    id: "quick-restarts",
    side: "ops",
    title: "Quick restarts — workflow granularity",
    source: "/ops/rhythm",
    size: "half",
    chip: () => <QuickRestartParam />,
    detail: () => <QuickRestartsPanel />,
    widget: () => <QuickRestartsPanel limit={8} />,
  },
  {
    id: "stat-failure-events",
    side: "ops",
    title: "Failure events",
    source: "/ops/failures",
    size: "stat",
    detail: () => (
      <StatWidget
        pick={(s) => count(s.failure_events)}
        label="failure events in window"
        caption="event-timestamp membership"
      />
    ),
  },
  {
    id: "stat-active-clients",
    side: "ops",
    title: "Active clients",
    source: "/ops/environments",
    size: "stat",
    detail: () => (
      <StatWidget
        pick={(s) => count(s.active_clients)}
        label="clients active in window"
        caption="event-timestamp membership"
      />
    ),
  },
  {
    id: "stat-active-auditors",
    side: "ops",
    title: "Active auditors",
    source: "/ops/rhythm",
    size: "stat",
    detail: () => (
      <StatWidget
        pick={(s) => count(s.active_auditors)}
        label="auditors active in window"
        caption="event-timestamp membership"
      />
    ),
  },
  // --------------------------------------------------------------- product
  {
    id: "job-share",
    side: "product",
    title: "What work is this used for?",
    source: "/product/usage",
    size: "half",
    chip: () => <ProvenanceChip kind="model" method="J3 job-type classification (session grain)" />,
    detail: () => <JobSharePanel />,
    widget: () => <JobSharePanel compact />,
  },
  {
    id: "lob-timeline",
    side: "product",
    title: "Client activity over time — turns per day by client",
    source: "/product/usage",
    size: "full",
    detail: () => <LobTimelinePanel />,
  },
  {
    id: "auditor-grid",
    side: "product",
    title: "Auditor × client load",
    source: "/product/usage",
    size: "half",
    detail: () => <AuditorClientGridPanel />,
  },
  {
    id: "family-adoption",
    side: "product",
    title: "Capability adoption — who uses which tool surface, and is it growing?",
    source: "/product/usage",
    size: "half",
    detail: () => <FamilyAdoptionPanel />,
  },
  {
    id: "outcome-bars",
    side: "product",
    title: "Do tasks finish?",
    source: "/product/outcomes",
    size: "full",
    chip: () => (
      <ProvenanceChip
        kind="model"
        method="J3 session outcome; undetermined is a first-class bucket"
      />
    ),
    detail: () => <OutcomeBarsPanel />,
  },
  {
    id: "interaction-strip",
    side: "product",
    title: "What does a completed task cost in human interactions?",
    source: "/product/outcomes",
    size: "full",
    chip: () => (
      <ProvenanceChip
        kind="heuristic"
        method="turns with a non-empty human-authored segment (marker-flag definition)"
      />
    ),
    detail: () => <InteractionStripPanel />,
  },
  {
    id: "friction-table",
    side: "product",
    title: "Where is the friction?",
    source: "/product/outcomes",
    size: "full",
    detail: () => <FrictionTablePanel />,
    widget: () => <FrictionTablePanel limit={5} />,
  },
  {
    id: "gap-ledger",
    side: "product",
    title: "Capability-gap ledger (the ranked feature backlog)",
    source: "/product/outcomes",
    size: "full",
    chip: () => (
      <ProvenanceChip
        kind="heuristic"
        method="structural workaround shapes; J4 supplies names only"
      />
    ),
    detail: () => <GapLedgerPanel />,
  },
  {
    id: "repeat-chains",
    side: "product",
    title: "Byte-identical re-invocations — repeat chains per turn",
    source: "/product/agent",
    size: "half",
    detail: () => <RepeatChainsPanel />,
    widget: () => <RepeatChainsPanel limit={5} />,
  },
  {
    id: "grind-table",
    side: "product",
    title: "Long same-tool runs per turn",
    source: "/product/agent",
    size: "half",
    chip: () => <GrindThresholdParam />,
    detail: () => <GrindTablePanel />,
    widget: () => <GrindTablePanel limit={5} />,
  },
  {
    id: "correction-feed",
    side: "product",
    title: "Correction feed — where the user re-steered",
    source: "/product/agent",
    size: "half",
    chip: () => (
      <ProvenanceChip
        kind="model"
        method="J2 correction classification over flagged candidate turns"
      />
    ),
    detail: () => <CorrectionFeedPanel />,
    widget: () => <CorrectionFeedPanel limit={3} />,
  },
  {
    id: "family-shapes",
    side: "product",
    title: "What happens after a failure, by tool family",
    source: "/product/agent",
    size: "half",
    detail: () => <FamilyShapesPanel />,
  },
  {
    id: "stat-sessions",
    side: "product",
    title: "Sessions",
    source: "/product/usage",
    size: "stat",
    detail: () => (
      <StatWidget
        pick={(s) => count(s.contained)}
        label="sessions in window"
        caption="whole-session containment"
      />
    ),
  },
  {
    id: "stat-turns",
    side: "product",
    title: "Turns",
    source: "/product/usage",
    size: "stat",
    detail: () => (
      <StatWidget
        pick={(s) => count(s.turns)}
        label="turns in window"
        caption="event-timestamp membership"
      />
    ),
  },
  {
    id: "stat-determined",
    side: "product",
    title: "Determined sessions",
    source: "/product/outcomes",
    size: "stat",
    detail: () => (
      <StatWidget
        pick={(s) => `${count(s.determined)} of ${count(s.contained)}`}
        label="contained sessions determined"
        caption="whole-session containment"
      />
    ),
  },
  {
    id: "stat-auth-overhead",
    side: "product",
    title: "Auth overhead",
    source: "/product/outcomes",
    size: "stat",
    detail: () => <AuthOverheadWidget />,
  },
  {
    id: "stat-chain-turns",
    side: "product",
    title: "Identical-input chains",
    source: "/product/agent",
    size: "stat",
    detail: () => (
      <StatWidget
        pick={(s) => count(s.chain_turns)}
        label="turns with identical-input chains"
        caption="event-timestamp membership"
      />
    ),
  },
];

export const widgetById = (id: string): WidgetDef | undefined => WIDGETS.find((w) => w.id === id);
