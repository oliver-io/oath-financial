// Raw-row spot-check schemas for data/*.jsonl, per SCHEMA.md.
// Contract: docs/architecture/etl.md stage 0 — zod spot-validation of a sample per
// file, fail fast on schema drift. Deliberately loose (`loose()`): SCHEMA.md says
// no fields were added/removed/renamed, but we only assert what the pipeline
// actually consumes. Known data facts: `output` missing on 42 observation rows;
// usageDetails/costDetails only on GENERATION rows (714 of 763 carry them).

import { z } from "zod";

const MessageSchema = z
  .object({
    role: z.string(),
    content: z.string(),
  })
  .loose();

export const RawTraceSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{32}$/),
    name: z.string(), // "Turn N"
    timestamp: z.string(), // the reliable time signal (SCHEMA.md)
    input: MessageSchema,
    output: MessageSchema.nullish(),
    metadata: z
      .object({
        session_id: z.string(),
        turn_number: z.number().int().positive(),
        client: z.string(),
        entity: z.string().nullish(),
        linux_user: z.string().nullish(),
        auditor_email: z.string().nullish(),
        source: z.literal("claude-code"),
      })
      .loose(),
    observations: z.array(z.string()),
  })
  .loose();

export const RawObservationSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{16}$/),
    traceId: z.string().regex(/^[0-9a-f]{32}$/),
    type: z.enum(["TOOL", "GENERATION", "SPAN"]),
    name: z.string(),
    input: z.unknown(),
    /** Absent on 42 rows — load-bearing-field handling in docs/architecture/llm.md. */
    output: z.unknown().nullish(),
    metadata: z
      .object({
        tool_name: z.string().nullish(),
        tool_id: z.string().nullish(),
        tool_count: z.number().int().nullish(),
      })
      .loose()
      .nullish(),
    parentObservationId: z.string().nullish(),
  })
  .loose();

export type RawTrace = z.infer<typeof RawTraceSchema>;
export type RawObservation = z.infer<typeof RawObservationSchema>;
