// Placeholder page — replaced at its milestone (A3–A5). Renders the side
// identity and one real windowed query so the route is live end-to-end.

import { ErrorState, Skeleton } from "../components/shared/honesty.tsx";
import { useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import { CountSchema, qTurnCount } from "../data/queries.ts";
import { count } from "../fmt.ts";
import { EventSemanticsCaption, PageTitle } from "./PageScaffold.tsx";

export function ProductUsagePage() {
  const win = useWindow();
  const filters = useFilters();
  const turns = useRows(CountSchema, qTurnCount(win, filters), win);
  return (
    <div>
      <PageTitle
        side={"product"}
        title="Usage"
        question="Who uses this, for what work, where is it concentrated?"
      />
      {turns.error && <ErrorState message={turns.error} />}
      {turns.loading && <Skeleton progress={turns.fetchProgress} />}
      {turns.rows && (
        <p className="text-sm text-ink-2 tabular">
          {count(turns.rows[0]?.n ?? 0)} turns in window.
        </p>
      )}
      <EventSemanticsCaption />
    </div>
  );
}
