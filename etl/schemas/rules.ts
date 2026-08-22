// Rule-file shapes: the four versioned YAML files under etl/rules/.
// Contract: docs/plans/etl.md §3 RuleSet — parsed + zod-validated into frozen
// objects at startup; content hashes recorded in the manifest. Taxonomy values
// come from docs/architecture/derivations.md §5 (signature_class) and §1
// (tool_family).

import { z } from "zod";

// -- signatures.yaml ---------------------------------------------------------

/** derivations.md §5 signature_class enum (curated). */
export const SignatureClassSchema = z.enum([
  "auth_token",
  "provisioning_config",
  "missing_resource",
  "platform_tool_fault",
  "agent_code_crash",
  "subagent_failure",
  "platform_limit",
]);

/** Per-signature failure semantics: true | false | uncertain
 * (uncertain routes the match to J1 gray-zone adjudication). */
export const CountsAsFailureSchema = z.union([z.boolean(), z.literal("uncertain")]);

export const SignatureRuleSchema = z.object({
  pattern_id: z.string().regex(/^[a-z0-9-]+$/), // stable public deeplink key
  display_name: z.string(),
  signature_class: SignatureClassSchema,
  counts_as_failure: CountsAsFailureSchema,
  /** Anchored regex source — NEVER a bare substring (amounts collide with 403). */
  pattern: z.string(),
  /** Restricts the rule to these tool_names (null = any tool). Curated data:
   * e.g. askuserquestion-exit-1 only means "user declined" on AskUserQuestion. */
  tool_scope: z.array(z.string()).nullable().default(null),
  /** Which text the pattern reads: tool outputs (derive.tool_events matching)
   * or the turn's assistant output (turn.platform_limit_marker). */
  target: z.enum(["tool_output", "assistant_output"]).default("tool_output"),
  /** True until the pattern has been verified against the real dataset. */
  provisional: z.boolean().default(false),
  /** Known false-positive/negative modes — documentation as data, surfaces in
   * the UI's evidence popovers (docs/plans/etl.md §5). */
  notes: z.string().default(""),
});

export const SignaturesFileSchema = z.object({
  version: z.string(),
  signatures: z.array(SignatureRuleSchema).min(1),
});

// -- tool_families.yaml ------------------------------------------------------

/** derivations.md §1 tool_family rollup enum. */
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

export const ToolFamiliesFileSchema = z.object({
  version: z.string(),
  /** tool_name → family, covering all 69 tools in the dataset. */
  families: z.record(z.string(), ToolFamilySchema),
});

// -- thresholds.yaml ---------------------------------------------------------

export const ThresholdsFileSchema = z.object({
  version: z.string(),
  /** Cap for capped_gap_span_s / bout segmentation (derivations.md §3/§4). */
  gap_cap_s: z.number().positive(),
  /** quick_restart_after_s window (derivations.md §3): under 1h. */
  quick_restart_window_s: z.number().positive(),
  /** matched_snippet radius for evidence popovers (docs/architecture/etl.md stage 5). */
  matched_snippet_radius_chars: z.number().int().positive(),
  /** Incident detection: rate excursion vs signature baseline (stage 4). */
  incident_excursion_multiplier: z.number().positive(),
  /** Fork gate lockstep window (stage 1) — see thresholds.yaml notes. */
  fork_lockstep_threshold_s: z.number().positive(),
  j5: z.object({
    unmatched_sample_n: z.number().int().positive(), // N=150 per llm.md
    matched_sample_m: z.number().int().positive(), // M=100 per llm.md
    seed: z.number().int(), // seeded so re-runs are comparable
  }),
  /** Structural-marker templates on user messages (derivations.md §2 —
   * independent flags, matched anywhere in the message). Verbatim template
   * strings verified against the dataset (113/115/98 hits). */
  markers: z.object({
    task_notification: z.string(),
    skill_body: z.string(),
    extract_paste: z.string(),
  }),
  /** short_typed_after_short_gap candidate flag (derivations.md §2): a short
   * typed prefix arriving after a short gap. Provisional pending tuning. */
  correction_candidate: z.object({
    max_typed_chars: z.number().int().positive(),
    max_gap_s: z.number().positive(),
  }),
});

// -- findings.yaml -----------------------------------------------------------

export const ProvenanceClassSchema = z.enum(["structural", "heuristic", "curated", "model"]);

export const FindingRuleSchema = z.object({
  finding_id: z.string().regex(/^[a-z0-9-]+$/),
  audience: z.enum(["ops", "product"]),
  title: z.string(),
  /** Threshold parameters the claim is computed from (stage 5 v_findings). */
  claim_params: z.record(z.string(), z.unknown()),
  metric: z.string(),
  /** URL params for the card's deeplink target. */
  target_params: z.record(z.string(), z.string()),
  provenance: ProvenanceClassSchema,
  /** Rows with false are exactly the degraded-mode card set. */
  requires_enrichment: z.boolean(),
});

export const FindingsFileSchema = z.object({
  version: z.string(),
  findings: z.array(FindingRuleSchema),
});

// -- combined ----------------------------------------------------------------

export type SignatureRule = z.infer<typeof SignatureRuleSchema>;
export type SignaturesFile = z.infer<typeof SignaturesFileSchema>;
export type ToolFamily = z.infer<typeof ToolFamilySchema>;
export type ToolFamiliesFile = z.infer<typeof ToolFamiliesFileSchema>;
export type ThresholdsFile = z.infer<typeof ThresholdsFileSchema>;
export type FindingsFile = z.infer<typeof FindingsFileSchema>;
export type ProvenanceClass = z.infer<typeof ProvenanceClassSchema>;

/** The four validated rule files plus their content hashes (for the manifest). */
export interface RuleSet {
  signatures: SignaturesFile;
  toolFamilies: ToolFamiliesFile;
  thresholds: ThresholdsFile;
  findings: FindingsFile;
  hashes: Record<string, string>;
}
