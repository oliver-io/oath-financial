// /ops — the Ops room dashboard: a pinnable widget board composed from the
// room's sub-pages (which keep their focused reports).

import { WidgetBoard } from "../components/dashboard/WidgetBoard.tsx";

export function OpsDashboardPage() {
  return <WidgetBoard side="ops" />;
}
