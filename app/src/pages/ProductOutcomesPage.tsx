// /product/outcomes — "Do tasks finish, what do they cost in human
// interactions, where is the friction?" Session-grain: whole-containment
// semantics with the excluded-count caption.

import { ExcludedSessionsList } from "../components/shared/ExcludedSessionsList.tsx";
import { GhostCard } from "../components/shared/honesty.tsx";
import { ContainmentCaption, PageTitle, PanelSection } from "./PageScaffold.tsx";

export function ProductOutcomesPage() {
  return (
    <div>
      <PageTitle
        side="product"
        title="Outcomes"
        question="Do tasks finish, what do they cost in human interactions, where is the friction?"
        stats={[
          { id: "stat-determined", side: "product" },
          { id: "stat-auth-overhead", side: "product" },
        ]}
      />
      <ContainmentCaption />
      <div className="mt-3">
        <ExcludedSessionsList />
      </div>
      <PanelSection id="outcome-bars" />
      <PanelSection id="interaction-strip" />
      <PanelSection id="friction-table" />
      <PanelSection id="gap-ledger" />
      <div className="grid max-w-2xl grid-cols-1 gap-3 md:grid-cols-2">
        <GhostCard
          title="Cost analysis"
          reason="This telemetry undercounts tokens 15-20x (single-generation capture); any dollar or token figure would be invented."
        />
        <GhostCard
          title="Session duration league table"
          reason="Wall spans include days of absence; summed durations would fabricate effort. Engaged-time appears per session with its gap cap stated."
        />
      </div>
    </div>
  );
}
