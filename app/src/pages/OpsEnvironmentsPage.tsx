// /ops/environments — "Which client box is unhealthy?" Panels via the registry.

import { EventSemanticsCaption, PageTitle, PanelSection } from "./PageScaffold.tsx";

export function OpsEnvironmentsPage() {
  return (
    <div>
      <PageTitle
        side="ops"
        title="Environments"
        question="Which client box is unhealthy?"
        stats={[{ id: "stat-active-clients", side: "ops" }]}
      />
      <PanelSection id="env-heatmap" />
      <PanelSection id="telemetry-integrity" />
      <EventSemanticsCaption />
    </div>
  );
}
