// /ops/rhythm — "When and in what pattern does each auditor work?"
// All constructs turn-grain -> event semantics; the gap cap appears as a
// stated parameter on each panel's chip.

import { EventSemanticsCaption, PageTitle, PanelSection } from "./PageScaffold.tsx";

export function OpsRhythmPage() {
  return (
    <div>
      <PageTitle
        side="ops"
        title="Working rhythm"
        question="When and in what pattern does each auditor work?"
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
