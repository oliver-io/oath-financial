// The clickable list behind the excluded-count caption (ui.md §2): sessions
// that overlap the window but aren't fully contained.

import { Link, useLocation, useNavigate } from "react-router";
import { useFilters, useRows, useWindow } from "../../data/DataContext.tsx";
import { ExcludedSessionSchema, qExcludedSessions } from "../../data/queries.ts";
import { count, tsLabel } from "../../fmt.ts";
import { filtersToSearch } from "../../state/urlState.ts";

export function ExcludedSessionsList() {
  const win = useWindow();
  const filters = useFilters();
  const navigate = useNavigate();
  const location = useLocation();
  const rows = useRows(ExcludedSessionSchema, qExcludedSessions(win, filters), null);
  if (filters.session !== "excluded") return null;
  return (
    <div className="mb-6 rounded border border-hairline bg-paper p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium text-ink">
          Sessions overlapping this window but not fully contained (excluded from
          session-grain counts)
        </span>
        <button
          type="button"
          className="cursor-pointer text-ink-3 hover:text-ink"
          onClick={() =>
            navigate({
              pathname: location.pathname,
              search: filtersToSearch({ ...filters, session: null }),
            })
          }
        >
          ✕ close
        </button>
      </div>
      <table className="w-full border-collapse text-xs tabular">
        <tbody>
          {(rows.rows ?? []).map((r) => (
            <tr key={r.session_id} className="border-b border-hairline last:border-b-0">
              <td className="py-1 pr-2">
                <Link to={`/session/${r.session_id}`} className="font-mono text-[11px] underline decoration-dotted">
                  {r.session_id}
                </Link>
              </td>
              <td className="py-1 pr-2">{r.auditor}</td>
              <td className="py-1 pr-2">{r.client}</td>
              <td className="py-1 pr-2 text-[10px] text-ink-3">
                {tsLabel(r.first_ts)} → {tsLabel(r.last_ts)}
              </td>
              <td className="py-1 text-right">{count(r.turn_count)} turns</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-ink-3">
        Whole-session containment censors long sessions near window boundaries — a documented
        caveat; the default full-range window avoids it.
      </p>
    </div>
  );
}
