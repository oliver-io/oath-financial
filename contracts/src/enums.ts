// Shared enums and stable public keys for the serving contract.
// Transcribed EXACTLY from docs/architecture/derivations.md (field catalog) and
// docs/architecture/etl.md stage 4/5 — do not "improve" values here; a change
// requires touching the corresponding architecture doc in the same change.

import { z } from "zod";

/** Provenance classes — derivations.md preamble. `structural` is the unchipped default. */
export const ProvenanceClassSchema = z.enum(["structural", "heuristic", "curated", "model"]);

/** derivations.md §1 tool_family (8 values — derivations.md wins over the "7 families" prose). */
export const ToolFamilySchema = z.enum([
  "shell",
  "file",
  "browser",
  "docstore",
  "subagent",
  "task",
  "search",
  "other",
]);

/** derivations.md §5 signature_class (7 curated classes). */
export const SignatureClassSchema = z.enum([
  "auth_token",
  "provisioning_config",
  "missing_resource",
  "platform_tool_fault",
  "agent_code_crash",
  "subagent_failure",
  "platform_limit",
]);

/** Curated tri-state on a signature — derivations.md §1/§5 (`true | false | uncertain`). */
export const CountsAsFailureSchema = z.enum(["true", "false", "uncertain"]);

/** Merged per-event failure verdict — docs/architecture/etl.md stage 4. */
export const FailureVerdictSchema = z.enum([
  "rule",
  "model_added",
  "model_cleared",
  "uncertain",
  "none",
]);

/** derivations.md §1 post_failure_shape (nullable at the row level). */
export const PostFailureShapeSchema = z.enum([
  "same_tool_clean_later",
  "other_calls_after",
  "turn_ends_on_failure",
]);

/** derivations.md §3 job_type taxonomy (model-class; revision expected post-first-run). */
export const JobTypeSchema = z.enum([
  "doc_receipt_check",
  "doc_location",
  "doc_inventory",
  "tie_out",
  "extraction_supervision",
  "drafting",
  "capability_probe",
  "other",
]);

/** Session outcome as PUBLISHED — docs/architecture/etl.md stage 5 ref/sessions:
 * `completed | abandoned | undetermined | unclassified | NULL`.
 * `unclassified` = enrichment abstention/error; NULL = job not run (degraded).
 * The UI renders all three non-determined states differently. */
export const SessionOutcomeSchema = z.enum([
  "completed",
  "abandoned",
  "undetermined",
  "unclassified",
]);

/** derivations.md §2 friction_cause. */
export const FrictionCauseSchema = z.enum([
  "system_failure",
  "capability_gap",
  "agent_behavior",
  "user_request",
  "none",
]);

/** Findings card audience — docs/plans/ui.md §3. */
export const FindingAudienceSchema = z.enum(["ops", "product"]);

/** Dimension kinds served in ref/dims — derivations.md §8 shared slice axes. */
export const DimKindSchema = z.enum([
  "client",
  "entity",
  "auditor",
  "tool_family",
  "job_type",
  "signature_class",
]);

export type ProvenanceClass = z.infer<typeof ProvenanceClassSchema>;
export type ToolFamily = z.infer<typeof ToolFamilySchema>;
export type SignatureClass = z.infer<typeof SignatureClassSchema>;
export type CountsAsFailure = z.infer<typeof CountsAsFailureSchema>;
export type FailureVerdict = z.infer<typeof FailureVerdictSchema>;
export type PostFailureShape = z.infer<typeof PostFailureShapeSchema>;
export type JobType = z.infer<typeof JobTypeSchema>;
export type SessionOutcome = z.infer<typeof SessionOutcomeSchema>;
export type FrictionCause = z.infer<typeof FrictionCauseSchema>;
export type FindingAudience = z.infer<typeof FindingAudienceSchema>;
export type DimKind = z.infer<typeof DimKindSchema>;
