// RunContext construction: duckdb session, loaded+validated rules, manifest
// recorder, logger, env handling.
// Contract: docs/plans/etl.md §2 context.ts and §5 — ALL env reads live here
// (OPENAI_API_KEY, OPENAI_BASE_URL, ETL_MODEL_*); absence of key while
// enrichment is requested is a clear startup error, not a mid-run surprise.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { type DuckDbSession, openDuckDb } from "./lib/duckdb.ts";
import { MissingCredentialsError } from "./lib/errors.ts";
import { sha256File, sha256Text } from "./lib/hash.ts";
import { createLogger, type Logger } from "./lib/log.ts";
import { ManifestRecorder } from "./lib/manifest.ts";
import {
  FindingsFileSchema,
  type RuleSet,
  SignaturesFileSchema,
  ThresholdsFileSchema,
  ToolFamiliesFileSchema,
} from "./schemas/rules.ts";
import {
  type ClientFactory,
  OpenAiClient,
  realSleep,
  type Sleep,
} from "./stages/s3_enrich/client.ts";

export interface EnrichmentEnv {
  apiKey: string;
  baseUrl: string | null;
  /** Snippet-level jobs J1/J5 (docs/architecture/llm.md cost envelope). */
  modelFast: string;
  /** Contextual-judgment jobs J2/J3/J4. */
  modelStrong: string;
}

/** Named points where a test may inject a fault to simulate a mid-run kill
 * (docs/plans/etl_testing.md §3 publish atomicity + resume/cache). Stage code
 * calls `ctx.injectFault?.(point)` at each point; production passes nothing. */
export type FaultPoint = "s3_after_batch_write" | "s5_after_partition_writes";
export type FaultInjector = (point: FaultPoint) => void;

export interface RunContext {
  runId: string;
  db: DuckDbSession;
  rules: RuleSet;
  manifest: ManifestRecorder;
  log: Logger;
  /** null exactly when enrichment was not requested (--no-enrich / enrich-less run). */
  enrichment: EnrichmentEnv | null;
  /** Constructs the LLM client — the sanctioned test seam
   * (docs/plans/etl_testing.md §4). Production default: OpenAiClient. */
  clientFactory: ClientFactory;
  /** Injectable so backoff tests don't wait (docs/plans/etl_testing.md §2). */
  sleep: Sleep;
  /** Test-only fault hook; null in production. */
  injectFault: FaultInjector | null;
  /** In-flight LLM calls: the test override, or thresholds.yaml's value. */
  enrichmentConcurrency: number;
  paths: {
    root: string;
    build: string;
    pipelineDb: string;
    llmCache: string;
    manifestDir: string;
    serveDir: string;
  };
}

/** "required": enrichment explicitly requested — missing key is a startup error.
 * "auto": `etl run` default — enrichment included if credentials are available,
 * else degrade (docs/architecture/etl.md: "enrichment included if cache/API
 * available"). "off": --no-enrich. */
export type EnrichmentMode = "required" | "auto" | "off";

export interface RunContextOptions {
  rootDir: string;
  enrichmentMode: EnrichmentMode;
  /** Injectable env for tests — production passes process.env (docs/plans/etl_testing.md §2). */
  env?: Record<string, string | undefined>;
  /** Injectable clock so run_id is deterministic in tests. */
  now?: () => Date;
  logSink?: (line: string) => void;
  /** Test seam: scripted-client injection (docs/plans/etl_testing.md §4). */
  clientFactory?: ClientFactory;
  /** Test seam: recorded/instant sleep for backoff assertions. */
  sleep?: Sleep;
  /** Test seam: simulated mid-run kill at a named point. */
  injectFault?: FaultInjector;
  /** Test seam: pins in-flight LLM calls (the scripted client's shared
   * per-call cursor needs a deterministic consumption order — the harness
   * passes 1). Production: thresholds.yaml `enrichment.concurrency`. */
  enrichmentConcurrency?: number;
}

const RULE_FILES = ["signatures", "tool_families", "thresholds", "findings"] as const;

export async function createRunContext(opts: RunContextOptions): Promise<RunContext> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => new Date());
  const log = createLogger(opts.logSink);

  // Enrichment credentials: resolved up front so a missing key fails at
  // startup (mode "required"), never as a mid-run surprise.
  let enrichment: EnrichmentEnv | null = null;
  if (opts.enrichmentMode !== "off") {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey && opts.enrichmentMode === "required") {
      throw new MissingCredentialsError(
        "enrichment requested but OPENAI_API_KEY is not set (use --no-enrich to run degraded)",
      );
    }
    enrichment = !apiKey
      ? null
      : {
          apiKey,
          baseUrl: env.OPENAI_BASE_URL ?? null,
          modelFast: env.ETL_MODEL_FAST ?? "gpt-5-mini",
          modelStrong: env.ETL_MODEL_STRONG ?? "gpt-5",
        };
  }

  const rules = await loadRules(join(opts.rootDir, "etl", "rules"));

  const buildDir = join(opts.rootDir, "build");
  const paths = {
    root: opts.rootDir,
    build: buildDir,
    pipelineDb: join(buildDir, "pipeline.duckdb"),
    llmCache: join(buildDir, "llm_cache.sqlite"),
    manifestDir: join(buildDir, "manifest"),
    serveDir: join(buildDir, "serve"),
  };
  mkdirSync(paths.manifestDir, { recursive: true });

  const inputHashes: Record<string, string> = {};
  for (const f of ["traces.jsonl", "observations.jsonl"]) {
    inputHashes[f] = await sha256File(join(opts.rootDir, "data", f));
  }

  // run_id = timestamp + input-hash prefix (docs/plans/etl.md §4 step 2).
  const ts = now().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  const hashPrefix = sha256Text(Object.values(inputHashes).join("|")).slice(0, 8);
  const runId = `${ts}-${hashPrefix}`;

  const manifest = new ManifestRecorder(
    runId,
    now().toISOString(),
    inputHashes,
    rules.hashes,
    { ...rules.thresholds, version: rules.thresholds.version },
    paths.manifestDir,
    env.ETL_GIT_REV ?? null,
  );

  const db = await openDuckDb(paths.pipelineDb);
  return {
    runId,
    db,
    rules,
    manifest,
    log,
    enrichment,
    clientFactory: opts.clientFactory ?? ((e, sleep) => new OpenAiClient(e, sleep)),
    sleep: opts.sleep ?? realSleep,
    injectFault: opts.injectFault ?? null,
    enrichmentConcurrency: opts.enrichmentConcurrency ?? rules.thresholds.enrichment.concurrency,
    paths,
  };
}

/** Parses + zod-validates the four rule files into a frozen RuleSet.
 * A rule file failing to parse/validate is a startup error (docs/plans/etl.md §3).
 * Signature-regex compilation deliberately lives in s2_derive's prepare(),
 * next to where the compiled rules are installed — not here. */
export async function loadRules(rulesDir: string): Promise<RuleSet> {
  const texts: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  for (const name of RULE_FILES) {
    const text = await Bun.file(join(rulesDir, `${name}.yaml`)).text();
    texts[name] = text;
    hashes[`${name}.yaml`] = sha256Text(text);
  }
  const ruleSet: RuleSet = {
    signatures: SignaturesFileSchema.parse(parseYaml(texts.signatures ?? "")),
    toolFamilies: ToolFamiliesFileSchema.parse(parseYaml(texts.tool_families ?? "")),
    thresholds: ThresholdsFileSchema.parse(parseYaml(texts.thresholds ?? "")),
    findings: FindingsFileSchema.parse(parseYaml(texts.findings ?? "")),
    hashes,
  };
  return Object.freeze(ruleSet);
}
