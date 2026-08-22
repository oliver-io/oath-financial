// /product/agent — "Where does the agent repeat itself, run long, or get corrected?"
// Turn/event-grain; counts are facts, names are judgments.

import { EventSemanticsCaption, PageTitle, PanelSection } from "./PageScaffold.tsx";

export function ProductAgentPage() {
  return (
    <div>
      <PageTitle
        side="product"
        title="Agent behavior"
        question="Where does the agent repeat itself, run long, or get corrected?"
        stats={[{ id: "stat-chain-turns", side: "product" }]}
      />
      <EventSemanticsCaption />
      <div className="mt-6">
        <PanelSection id="repeat-chains" />
        <PanelSection id="grind-table" />
        <PanelSection id="correction-feed" />
        <PanelSection id="family-shapes" />
      </div>
    </div>
  );
}
