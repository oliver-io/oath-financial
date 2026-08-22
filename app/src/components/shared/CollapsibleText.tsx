// Transcript text collapsed beyond a threshold (ui.md §3: user text collapsed
// beyond 500 chars; a 46KB paste must stay usable).

import { useState } from "react";
import { chars } from "../../fmt.ts";

export function CollapsibleText({
  text,
  limit = 500,
  tone,
}: {
  text: string;
  limit?: number;
  tone: "user" | "assistant";
}) {
  const [open, setOpen] = useState(false);
  const needsCollapse = text.length > limit;
  const shown = open || !needsCollapse ? text : text.slice(0, limit);
  return (
    <div
      className={`whitespace-pre-wrap break-words rounded p-2 text-[13px] leading-relaxed ${
        tone === "user" ? "bg-paper text-ink" : "bg-surface text-ink-2"
      }`}
    >
      {shown}
      {needsCollapse && (
        <button
          type="button"
          className="ml-1 cursor-pointer text-xs text-ink-3 underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "collapse" : `… show all (${chars(text.length)})`}
        </button>
      )}
    </div>
  );
}
