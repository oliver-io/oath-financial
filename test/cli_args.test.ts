// Pure structural tests: CLI argument parsing (docs/plans/etl.md §2 cli.ts).
// Legitimately green in the red phase — no pipeline logic involved.

import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "../etl/cli.ts";

describe("parseCliArgs", () => {
  test("run defaults", () => {
    expect(parseCliArgs(["run"])).toEqual({
      command: "run",
      flags: { noEnrich: false, stage: null, sqlite: false },
    });
  });

  test("run --no-enrich --sqlite", () => {
    expect(parseCliArgs(["run", "--no-enrich", "--sqlite"])).toEqual({
      command: "run",
      flags: { noEnrich: true, stage: null, sqlite: true },
    });
  });

  test("run --stage N parses and bounds-checks 0..5", () => {
    expect(parseCliArgs(["run", "--stage", "2"]).flags).toMatchObject({ stage: 2 });
    expect(parseCliArgs(["run", "--stage", "0"]).flags).toMatchObject({ stage: 0 });
    expect(parseCliArgs(["run", "--stage", "5"]).flags).toMatchObject({ stage: 5 });
    expect(() => parseCliArgs(["run", "--stage", "6"])).toThrow("--stage must be 0..5");
    expect(() => parseCliArgs(["run", "--stage=-1"])).toThrow("--stage must be 0..5");
    expect(() => parseCliArgs(["run", "--stage", "abc"])).toThrow("--stage must be 0..5");
  });

  test("enrich defaults and flags", () => {
    expect(parseCliArgs(["enrich"])).toEqual({
      command: "enrich",
      flags: { job: null, recache: false },
    });
    expect(parseCliArgs(["enrich", "--job", "J3", "--recache"])).toEqual({
      command: "enrich",
      flags: { job: "J3", recache: true },
    });
  });

  test("unknown or missing command is an error", () => {
    expect(() => parseCliArgs([])).toThrow("usage: etl");
    expect(() => parseCliArgs(["publish"])).toThrow("usage: etl");
  });
});
