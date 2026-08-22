// Generic enrichment-job executor: selector → packets → cache → call → write.
// Contract: docs/plans/etl.md §3 JobSpec/runner; docs/architecture/etl.md Stage 3.
// The runner owns everything generic: cache lookup by
// sha256(job|packet_hash|prompt_version|model), batching under the token
// budget, exponential backoff on 429/5xx (via the injected client/sleep;
// bounds are versioned data in thresholds.yaml `enrichment`), ONE schema-repair
// retry then an enrich_error row, transactional batch writes (killed runs
// resume at the record level off the cache), and the end-of-job invariant:
// EVERY selected record has exactly one row — a verdict, an abstention with
// reason, or an error. A failed invariant is a hard error
// (EnrichmentInvariantViolation → exit 3). Coverage counts go to the manifest.
//
// Records are processed SEQUENTIALLY (deliberate: deterministic script/cache/
// backoff interleaving is a test contract — docs/plans/etl_testing.md §7
// determinism; at this dataset's scale, <1,500 one-shot calls, concurrency
// buys nothing the cache doesn't already give re-runs).
//
// Batched responses: a call carrying N records accepts either a JSON array of
// N outputs (one per record, in order) or a single output object that applies
// to every record in the call (docs/plans/etl_testing.md §4 batch grain).

import { type ZodType, z } from "zod";
import type { RunContext } from "../../context.ts";
import { countRows, exec, querySqlFile, runSqlFile, sqlString } from "../../lib/duckdb.ts";
import { EnrichmentInvariantViolation } from "../../lib/errors.ts";
import { cacheKey, sha256Object } from "../../lib/hash.ts";
import { ensureEnrichTables } from "../../lib/rule_tables.ts";
import type { EnrichmentCoverage } from "../../schemas/run_manifest.ts";
import { executeStage, installSessionVariables } from "../executor.ts";
import { s0Raw } from "../s0_raw.ts";
import { s1Clean } from "../s1_clean.ts";
import { s2Derive } from "../s2_derive.ts";
import { LlmCache } from "./cache.ts";
import { LlmHttpError, type LlmClient, LlmTimeoutError, type Sleep } from "./client.ts";
import type { PacketBuilder } from "./packets.ts";

export type JobId = "J1" | "J2" | "J3" | "J4" | "J5";

/** What happened to one selected record. `error` rows carry a machine-readable
 * reason (`schema_failure`, `http_error`, `invented_exemplar`). */
export type RecordOutcome =
  | { kind: "judged" | "abstained"; output: Record<string, unknown>; dangling?: boolean }
  | { kind: "error"; reason: string };

/** Post-hoc validation result: the (possibly transformed) output to write, or
 * a rejection when the model invented data (docs/architecture/llm.md J2/J4). */
export type PostHocResult =
  | { kind: "ok"; output: Record<string, unknown>; dangling?: boolean }
  | { kind: "invented"; detail: string };

/** One enrichment job = (selector, packet builder, prompt, schema, writer).
 * Contract: docs/plans/etl.md §3 JobSpec. */
export interface JobSpec {
  id: JobId;
  /** SQL file (etl/stages/sql/) returning record keys + packet inputs. */
  selectorSqlFile: string;
  buildPacket: PacketBuilder;
  outputSchema: ZodType;
  promptTemplate: string;
  promptVersion: string;
  /** "fast" = snippet-level (J1/J5); "strong" = contextual judgment (J2/J3/J4). */
  modelTier: "fast" | "strong";
  /** SQL insert of verdict/abstention/error rows into enrich.<table>
   * (reads the _<id>_pending temp table the runner fills per batch). */
  writerSqlFile: string;
  /** The enrich.* table this job owns (delete-and-rebuild per run). */
  outputTable: string;
  /** Batch grain: records per call (J2 batches many turns of one session;
   * session-level jobs are one session per call). */
  batching: "per_record" | "per_session_batch";
  /** Optional temp-table setup the selector SQL joins against. */
  prepare?(ctx: RunContext): Promise<void>;
  /** True when a schema-valid output is an abstention (verdict/assessment
   * `insufficient`) rather than a judgment. */
  isAbstention(output: Record<string, unknown>): boolean;
  /** Post-hoc validation against stage-2 facts (llm.md: the model cannot
   * invent failures/exemplars). Identity when absent. */
  postHoc?(record: Record<string, unknown>, output: Record<string, unknown>): PostHocResult;
  /** Maps (selector record, outcome) to one output-table row. Pure. */
  toRow(record: Record<string, unknown>, outcome: RecordOutcome): Record<string, unknown>;
}

export interface RunJobOptions {
  ctx: RunContext;
  job: JobSpec;
  client: LlmClient;
  cache: LlmCache;
  sleep: Sleep;
  /** `etl enrich --recache`: ignore the cache (explicit flag, never default). */
  recache: boolean;
}

interface SelectedRecord {
  row: Record<string, unknown>;
  packet: ReturnType<PacketBuilder>;
}

/** DuckDB row → plain object: BigInt → Number, `*_json` columns parsed into
 * their unsuffixed keys (selectors emit nested structures as to_json text). */
function normalizeRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const value = typeof v === "bigint" ? Number(v) : v;
    if (k.endsWith("_json")) {
      out[k.slice(0, -5)] = typeof value === "string" ? JSON.parse(value) : value;
    } else {
      out[k] = value;
    }
  }
  return out;
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return sqlString(String(v));
}

/** Bootstraps stages 0–2 when the derive tables are absent — standalone
 * `etl enrich` / runJob invocations start from raw JSONL. */
async function ensureDerived(ctx: RunContext): Promise<void> {
  try {
    await countRows(ctx.db, "derive.sessions");
    return; // already materialized (full-pipeline path)
  } catch {
    // absent → build it below (the probe is the only sanctioned swallow here)
  }
  for (const stage of [s0Raw, s1Clean, s2Derive]) await executeStage(ctx, stage);
}

function modelIdFor(ctx: RunContext, job: JobSpec): string {
  if (ctx.enrichment === null) return `offline-${job.modelTier}`;
  return job.modelTier === "fast" ? ctx.enrichment.modelFast : ctx.enrichment.modelStrong;
}

function renderPrompt(job: JobSpec, packet: unknown, recordCount: number): string {
  const batchNote =
    recordCount > 1
      ? `\nThis packet carries ${recordCount} records ("turns" array, in order). Respond with a JSON array of ${recordCount} output objects, one per record in the same order.`
      : "\nRespond with ONLY one JSON object matching the required schema.";
  return `${job.promptTemplate}\n\nContext packet (JSON):\n${JSON.stringify(packet)}\n${batchNote}`;
}

type ParseResult =
  | { ok: true; outputs: Record<string, unknown>[] }
  | { ok: false; detail: string };

/** Validates a response for an N-record call: a JSON array of N schema-valid
 * outputs, or a single schema-valid object broadcast to all N records. */
function parseResponse(text: string, schema: ZodType, n: number): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, detail: `invalid: response is not JSON (${String(err)})` };
  }
  if (Array.isArray(value)) {
    if (value.length !== n) {
      return { ok: false, detail: `invalid: expected ${n} outputs, got ${value.length}` };
    }
    const outputs: Record<string, unknown>[] = [];
    for (const item of value) {
      const r = schema.safeParse(item);
      if (!r.success) return { ok: false, detail: `invalid: ${r.error.message}` };
      outputs.push(r.data as Record<string, unknown>);
    }
    return { ok: true, outputs };
  }
  const r = schema.safeParse(value);
  if (!r.success) return { ok: false, detail: `invalid: ${r.error.message}` };
  return { ok: true, outputs: Array.from({ length: n }, () => r.data as Record<string, unknown>) };
}

/** Executes one job end-to-end and returns its coverage counts
 * (judged / abstained / error / cached_hit) for the manifest. */
export async function runJob(opts: RunJobOptions): Promise<EnrichmentCoverage> {
  const { ctx, job, client, cache, sleep, recache } = opts;
  const thr = ctx.rules.thresholds.enrichment;
  const modelId = modelIdFor(ctx, job);
  const createdAt = ctx.manifest.snapshot().created_at;
  const responseJsonSchema = z.toJSONSchema(job.outputSchema) as Record<string, unknown>;

  await ensureDerived(ctx);
  await installSessionVariables(ctx);
  await ensureEnrichTables(ctx);
  await job.prepare?.(ctx);
  if (recache) cache.clear(job.id);

  const selected = (await querySqlFile(ctx.db, job.selectorSqlFile)).map(normalizeRow);
  // Idempotent per run: the job owns its table; rows are rebuilt from the
  // cache/API so a resumed run converges to exactly one row per record.
  await exec(ctx.db, `DELETE FROM ${job.outputTable}`);

  const records: SelectedRecord[] = selected.map((row) => ({
    row,
    packet: job.buildPacket(row),
  }));
  const batches = groupBatches(job, records);

  const coverage = { judged: 0, abstained: 0, error: 0, cached_hit: 0 };

  for (const batch of batches) {
    const rows: Record<string, unknown>[] = [];
    const skips = batch.filter((r) => r.packet.kind === "skip");
    const live = batch.filter((r) => r.packet.kind === "packet");

    for (const r of skips) {
      if (r.packet.kind !== "skip") continue;
      coverage.abstained += 1;
      // cached_hit counts records completed WITHOUT an API call this run:
      // cache hits and deterministic packet skips alike (zero-spend contract).
      coverage.cached_hit += 1;
      rows.push(
        job.toRow(r.row, {
          kind: "abstained",
          output: {
            verdict: "insufficient",
            insufficient_reason: r.packet.reason,
            evidence: r.packet.detail,
          },
        }),
      );
    }

    if (live.length > 0) {
      const batchPacket =
        job.batching === "per_session_batch"
          ? {
              session_id: live[0]?.row.session_id ?? null,
              turns: live.map((r) => (r.packet.kind === "packet" ? r.packet.packet : null)),
            }
          : ((live[0]?.packet as { packet: Record<string, unknown> }).packet ?? {});
      const packetHash = sha256Object(batchPacket);
      const key = cacheKey(job.id, packetHash, job.promptVersion, modelId);

      let responseText: string | null = null;
      let fromCache = false;
      if (!recache) {
        const hit = cache.get(key);
        if (hit) {
          responseText = hit.responseJson;
          fromCache = true;
        }
      }

      let outcome: { kind: "ok"; outputs: Record<string, unknown>[] } | { kind: "error"; reason: string };
      if (responseText !== null) {
        const parsed = parseResponse(responseText, job.outputSchema, live.length);
        // Cache only ever holds schema-valid text; a mismatch (schema evolved
        // without a version bump) degrades to a live call.
        if (parsed.ok) {
          outcome = { kind: "ok", outputs: parsed.outputs };
          coverage.cached_hit += live.length;
        } else {
          responseText = null;
          fromCache = false;
          outcome = { kind: "error", reason: "schema_failure" };
        }
      } else {
        outcome = { kind: "error", reason: "http_error" };
      }

      if (responseText === null) {
        outcome = await callAndValidate({
          job,
          client,
          sleep,
          prompt: renderPrompt(job, batchPacket, live.length),
          modelId,
          responseJsonSchema,
          n: live.length,
          maxTransportAttempts: thr.max_transport_attempts,
          backoffBaseMs: thr.backoff_base_ms,
        });
        if (outcome.kind === "ok" && !fromCache) {
          cache.put({
            key,
            job: job.id,
            packetHash,
            promptVersion: job.promptVersion,
            modelId,
            responseJson: JSON.stringify(
              outcome.outputs.length === live.length && job.batching === "per_session_batch"
                ? outcome.outputs
                : outcome.outputs[0],
            ),
            createdAt,
          });
        }
      }

      if (outcome.kind === "error") {
        for (const r of live) {
          coverage.error += 1;
          rows.push(job.toRow(r.row, { kind: "error", reason: outcome.reason }));
        }
      } else {
        for (const [i, r] of live.entries()) {
          const raw = outcome.outputs[i] as Record<string, unknown>;
          const post = job.postHoc?.(r.row, raw) ?? { kind: "ok" as const, output: raw };
          if (post.kind === "invented") {
            coverage.error += 1;
            rows.push(job.toRow(r.row, { kind: "error", reason: "invented_exemplar" }));
            continue;
          }
          const abstained = job.isAbstention(post.output);
          coverage[abstained ? "abstained" : "judged"] += 1;
          rows.push(
            job.toRow(r.row, {
              kind: abstained ? "abstained" : "judged",
              output: post.output,
              ...(post.dangling === undefined ? {} : { dangling: post.dangling }),
            }),
          );
        }
      }
    }

    await writeBatch(ctx, job, rows);
    ctx.injectFault?.("s3_after_batch_write");
  }

  const written = await countRows(ctx.db, job.outputTable);
  if (written !== selected.length) {
    throw new EnrichmentInvariantViolation(
      job.id,
      `${written} rows for ${selected.length} selected records`,
    );
  }
  ctx.log.info("s3_enrich", "job_complete", { job: job.id, ...coverage });
  return coverage;
}

/** J2 groups a session's turns into one call; a session whose combined packet
 * would blow the char budget is split deterministically. */
function groupBatches(job: JobSpec, records: SelectedRecord[]): SelectedRecord[][] {
  if (job.batching === "per_record") return records.map((r) => [r]);
  const budgetChars = 20_000 * 4; // TRUNCATION budget; packets stay well under
  const batches: SelectedRecord[][] = [];
  let current: SelectedRecord[] = [];
  let currentChars = 0;
  let currentSession: unknown;
  for (const r of records) {
    const size = r.packet.kind === "packet" ? JSON.stringify(r.packet.packet).length : 0;
    const sameSession = current.length > 0 && r.row.session_id === currentSession;
    if (!sameSession || currentChars + size > budgetChars) {
      if (current.length > 0) batches.push(current);
      current = [];
      currentChars = 0;
      currentSession = r.row.session_id;
    }
    current.push(r);
    currentChars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

interface CallArgs {
  job: JobSpec;
  client: LlmClient;
  sleep: Sleep;
  prompt: string;
  modelId: string;
  responseJsonSchema: Record<string, unknown>;
  n: number;
  maxTransportAttempts: number;
  backoffBaseMs: number;
}

/** One logical call: transport retries (exponential backoff on 429/5xx,
 * immediate retry on timeout) + ONE schema-repair retry. */
async function callAndValidate(
  args: CallArgs,
): Promise<{ kind: "ok"; outputs: Record<string, unknown>[] } | { kind: "error"; reason: string }> {
  let prompt = args.prompt;
  let repairUsed = false;
  let attempts = 0;
  let httpFailures = 0;
  while (attempts < args.maxTransportAttempts) {
    attempts += 1;
    let text: string;
    try {
      const response = await args.client.complete({
        job: args.job.id,
        model: args.modelId,
        prompt,
        responseJsonSchema: args.responseJsonSchema,
      });
      text = response.text;
    } catch (err) {
      if (err instanceof LlmHttpError) {
        if (attempts >= args.maxTransportAttempts) break;
        await args.sleep(args.backoffBaseMs * 2 ** httpFailures);
        httpFailures += 1;
        continue;
      }
      if (err instanceof LlmTimeoutError) continue; // one more attempt, no sleep
      throw err; // MissingCredentialsError etc. — fail loud, never a row
    }
    const parsed = parseResponse(text, args.job.outputSchema, args.n);
    if (parsed.ok) return { kind: "ok", outputs: parsed.outputs };
    if (repairUsed) return { kind: "error", reason: "schema_failure" };
    repairUsed = true;
    prompt = `${args.prompt}\n\nYour previous response was invalid: ${parsed.detail}\nRespond again with ONLY valid JSON matching the required schema.`;
  }
  return { kind: "error", reason: "http_error" };
}

/** Transactional batch write through the job's writer SQL file: fill the
 * pending temp table, INSERT inside one transaction, commit — a killed run
 * keeps every committed batch (docs/plans/etl_testing.md §3 resume). */
async function writeBatch(
  ctx: RunContext,
  job: JobSpec,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  const pending = `_${job.id.toLowerCase()}_pending`;
  await exec(
    ctx.db,
    `CREATE OR REPLACE TEMP TABLE ${pending} AS SELECT * FROM ${job.outputTable} LIMIT 0`,
  );
  const first = rows[0] as Record<string, unknown>;
  const columns = Object.keys(first);
  const values = rows
    .map((r) => `(${columns.map((c) => sqlLiteral(r[c])).join(", ")})`)
    .join(",\n");
  await exec(ctx.db, `INSERT INTO ${pending} (${columns.join(", ")}) VALUES ${values}`);
  await exec(ctx.db, "BEGIN TRANSACTION");
  try {
    await runSqlFile(ctx.db, job.writerSqlFile);
    await exec(ctx.db, "COMMIT");
  } catch (err) {
    await exec(ctx.db, "ROLLBACK");
    throw err;
  }
}

export interface SequenceFlags {
  recache: boolean;
}

/** Runs jobs in dependency order through one client/cache pair, recording
 * per-job coverage + model/prompt provenance into the manifest — the stage-3
 * path both `etl run` and `etl enrich` share. */
export async function runEnrichmentSequence(
  ctx: RunContext,
  jobs: readonly JobSpec[],
  flags: SequenceFlags,
): Promise<void> {
  if (ctx.enrichment === null) {
    // createRunContext("required") already errors; this guards the run path.
    throw new Error("enrichment sequence requested without credentials");
  }
  const client = ctx.clientFactory(ctx.enrichment, ctx.sleep);
  const cache = LlmCache.open(ctx.paths.llmCache);
  try {
    for (const job of jobs) {
      const coverage = await runJob({
        ctx,
        job,
        client,
        cache,
        sleep: ctx.sleep,
        recache: flags.recache,
      });
      ctx.manifest.recordEnrichment(job.id, coverage, modelIdFor(ctx, job), job.promptVersion);
    }
  } finally {
    cache.close();
  }
}
