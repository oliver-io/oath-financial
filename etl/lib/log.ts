// Structured line logger (stage, event, counts).
// Contract: docs/plans/etl.md §2 lib/log.ts — nothing else in the codebase prints;
// this is the single sanctioned console user (see biome.json override).

export type LogFields = Record<string, string | number | boolean | null>;

export interface Logger {
  info(component: string, event: string, fields?: LogFields): void;
  error(component: string, event: string, fields?: LogFields): void;
}

/** Creates the production logger: one JSON line per event on stdout/stderr.
 * Tests route lines into a capture buffer via `sink` (docs/plans/etl_testing.md §2). */
export function createLogger(sink?: (line: string) => void): Logger {
  const emit = (level: "info" | "error", component: string, event: string, fields?: LogFields) => {
    const line = JSON.stringify({ level, component, event, ...fields });
    if (sink) sink(line);
    else if (level === "error") console.error(line);
    else console.log(line);
  };
  return {
    info: (component, event, fields) => emit("info", component, event, fields),
    error: (component, event, fields) => emit("error", component, event, fields),
  };
}
