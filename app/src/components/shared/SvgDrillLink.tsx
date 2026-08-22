// The standard drill-in affordance for clickable marks INSIDE an SVG chart
// (bars, cells, dots): a real SVG <a href> — middle-click / copy-link work —
// that intercepts plain clicks for SPA navigation. Pair it with a <title>
// child on the mark saying what clicking does. HTML contexts use react-router
// <Link> directly; this exists only because <Link> renders an HTML anchor,
// which is invalid inside SVG.

import type { ReactNode } from "react";
import { type To, useHref, useNavigate } from "react-router";

export function SvgDrillLink({
  to,
  label,
  children,
}: {
  to: To;
  label: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const href = useHref(to);
  return (
    <a
      href={href}
      aria-label={label}
      className="cursor-pointer focus:outline-1"
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
