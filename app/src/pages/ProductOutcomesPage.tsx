// /product/outcomes — "Do tasks finish, what do they cost in human
// interactions, where is the wrestling?" (ui.md §3). Session-grain:
// whole-containment semantics with the excluded-count caption.

import { useMemo } from "react";
import { FrictionTable } from "../components/product/FrictionTable.tsx";
import { GapLedger } from "../components/product/GapLedger.tsx";
import { InteractionStrip } from "../components/product/InteractionStrip.tsx";
import { OutcomeBars } from "../components/product/OutcomeBars.tsx";
import { ExcludedSessionsList } from "../components/shared/ExcludedSessionsList.tsx";
import { ErrorState, GhostCard, ProvenanceChip, Skeleton } from "../components/shared/honesty.tsx";
import { useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import {
  CapabilityGapRowQ,
  FrictionRowSchema,
  GapExemplarSchema,
  InteractionCostDotSchema,
  OutcomeCountSchema,
  qCapabilityGaps,
  qFrictionTable,
  qGapExemplars,
  qInteractionCostDots,
  qOutcomesByJob,
} from "../data/queries.ts";
import { ContainmentCaption, PageTitle, Section } from "./PageScaffold.tsx";

export function ProductOutcomesPage() {
  const win = useWindow();
  const filters = useFilters();
  const outcomes = useRows(OutcomeCountSchema, qOutcomesByJob(win, filters), null);
  const dots = useRows(InteractionCostDotSchema, qInteractionCostDots(win, filters), null);
  const friction = useRows(FrictionRowSchema, qFrictionTable(win, filters), null);
  const gaps = useRows(CapabilityGapRowQ, qCapabilityGaps(), null);
  const exemplarRows = useRows(GapExemplarSchema, qGapExemplars(), null);
  const exemplars = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of exemplarRows.rows ?? [])
      m.set(e.gap_id, [...(m.get(e.gap_id) ?? []), e.session_id]);
    return m;
  }, [exemplarRows.rows]);

  return (
    <div>
      <PageTitle
        side="product"
        title="Outcomes"
        question="Do tasks finish, what do they cost in human interactions, where is the wrestling?"
      />
      <ContainmentCaption />
      <div className="mt-3">
        <ExcludedSessionsList />
      </div>

      <Section
        title="Do tasks finish?"
        chip={
          <ProvenanceChip
            kind="model"
            method="J3 session outcome; undetermined is a first-class bucket"
          />
        }
      >
        {outcomes.error && <ErrorState message={outcomes.error} />}
        {outcomes.loading && <Skeleton />}
        {outcomes.rows && <OutcomeBars rows={outcomes.rows} />}
      </Section>

      <Section
        title="What does a completed task cost in human interactions?"
        chip={
          <ProvenanceChip
            kind="heuristic"
            method="turns with a non-empty human-authored segment (marker-flag definition)"
          />
        }
      >
        {dots.loading && <Skeleton />}
        {dots.rows && <InteractionStrip dots={dots.rows} />}
      </Section>

      <Section title="Where is the wrestling?">
        {friction.loading && <Skeleton />}
        {friction.error && <ErrorState message={friction.error} />}
        {friction.rows && <FrictionTable rows={friction.rows} />}
      </Section>

      <Section
        title="Capability-gap ledger (the ranked feature backlog)"
        chip={
          <ProvenanceChip
            kind="heuristic"
            method="structural workaround shapes; J4 supplies names only"
          />
        }
      >
        {gaps.loading && <Skeleton />}
        {gaps.rows && <GapLedger gaps={gaps.rows} exemplars={exemplars} />}
        <p className="mt-1 text-[10px] text-ink-3">
          Gap aggregates are computed over the full dataset (reference plane); the window does not
          re-slice them.
        </p>
      </Section>

      <div className="grid max-w-2xl grid-cols-1 gap-3 md:grid-cols-2">
        <GhostCard
          title="Cost analysis"
          reason="This telemetry undercounts tokens 15–20× (single-generation capture); any dollar or token figure would be invented."
        />
        <GhostCard
          title="Session duration league table"
          reason="Wall spans include days of absence; summed durations would fabricate effort. Engaged-time appears per session with its gap cap stated."
        />
      </div>
    </div>
  );
}
