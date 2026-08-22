// /ops/environments — "Which client environments show elevated error rates?"
// Panels via the registry.

import { EventSemanticsCaption, PageTitle, PanelSection } from "./PageScaffold.tsx";

export function OpsEnvironmentsPage() {
  return (
    <div>
      <PageTitle
        side="ops"
        title="Environments"
        question="Which client environments show elevated error rates?"
        stats={[{ id: "stat-active-clients", side: "ops" }]}
      />
      <PanelSection id="env-heatmap" />
      <PanelSection id="telemetry-integrity" />
      <EventSemanticsCaption />
    </div>
  );
}
