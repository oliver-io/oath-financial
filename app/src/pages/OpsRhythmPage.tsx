// /ops/rhythm — "How does work actually flow, per auditor and engagement?"
// All constructs turn-grain -> event semantics; the gap cap appears as a
// stated parameter on each panel's chip.

import { EventSemanticsCaption, PageTitle, PanelSection } from "./PageScaffold.tsx";

export function OpsRhythmPage() {
  return (
    <div>
      <PageTitle
        side="ops"
        title="Working rhythm"
        question="How does work actually flow, per auditor and engagement?"
        stats={[{ id: "stat-active-auditors", side: "ops" }]}
      />
      <PanelSection id="activity-strips" />
      <PanelSection id="bout-profile" />
      <PanelSection id="span-scatter" />
      <PanelSection id="quick-restarts" />
      <EventSemanticsCaption />
    </div>
  );
}
