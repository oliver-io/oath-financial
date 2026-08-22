// /product/usage — "Who uses this, for what work, where is it concentrated?"
// Mixed grain: job share is session-grain (containment), the rest event-grain
// — both window rules captioned.

import {
  ContainmentCaption,
  EventSemanticsCaption,
  PageTitle,
  PanelSection,
} from "./PageScaffold.tsx";

export function ProductUsagePage() {
  return (
    <div>
      <PageTitle
        side="product"
        title="Usage"
        question="Who uses this, for what work, where is it concentrated?"
        stats={[{ id: "stat-turns", side: "product" }]}
      />
      <PanelSection id="job-share" />
      <ContainmentCaption />
      <div className="mt-6">
        <PanelSection id="lob-timeline" />
        <PanelSection id="auditor-grid" />
        <PanelSection id="family-adoption" />
      </div>
      <EventSemanticsCaption />
    </div>
  );
}
