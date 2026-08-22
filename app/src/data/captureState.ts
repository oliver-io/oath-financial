// Readiness contract for the app-capture skill (.claude/skills/app-capture):
// the shell maintains <html data-capture-state="booting|loading|ready|empty|
// error"> from the states the app already tracks — boot phase, in-flight
// query count (skeletons), mounted error states, and mounted first-class
// empty states. This module is the one shared counter store; useRows and the
// honesty components report into it.

type Kind = "loading" | "error" | "empty";

const counts: Record<Kind, number> = { loading: 0, error: 0, empty: 0 };
let boot: "booting" | "failed" | "ready" = "booting";
let windowEmpty = false;

export type CaptureState = "booting" | "loading" | "ready" | "empty" | "error";

function compute(): CaptureState {
  if (boot === "booting") return "booting";
  if (boot === "failed") return "error";
  if (counts.loading > 0) return "loading";
  if (counts.error > 0) return "error";
  if (counts.empty > 0 || windowEmpty) return "empty";
  return "ready";
}

function apply(): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.captureState = compute();
  }
}

/** Report a construct entering/leaving a state; symmetric with effect cleanup. */
export function trackCapture(kind: Kind, delta: 1 | -1): void {
  counts[kind] = Math.max(0, counts[kind] + delta);
  apply();
}

export function setBootCaptureState(state: "booting" | "failed" | "ready"): void {
  boot = state;
  apply();
}

/** Reported by the loader after each window change: true when the effective
 * window covers zero fact partitions (the first-class empty-window state). */
export function setWindowEmptyCaptureState(empty: boolean): void {
  windowEmpty = empty;
  apply();
}
