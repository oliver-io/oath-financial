// Compiled signature ruleset: signatures.yaml → anchored regexes, applied to
// one output text. Contract: docs/plans/etl.md §3 RuleSet ("Signature rules
// compile to anchored regexes once; a rule failing to compile is a startup
// error") and §6 golden signature tests ("runs the compiled rule set against
// snippets"). Stage 2 applies the same compiled set (this module is the single
// compilation point, so the fast unit loop and the stage-level authority share
// one implementation); tool_scope/target filtering is a stage-2 application
// concern — matchSignatures itself is text-only.

import type { SignatureRule, SignaturesFile } from "../schemas/rules.ts";

export interface CompiledSignature {
  readonly rule: SignatureRule;
  readonly regex: RegExp;
}

export interface CompiledRuleset {
  readonly version: string;
  readonly signatures: readonly CompiledSignature[];
}

/** One match of one signature against a text, with the evidence position the
 * matched_snippet derivation needs (docs/architecture/etl.md stage 5). */
export interface SignatureMatch {
  readonly patternId: string;
  readonly countsAsFailure: boolean | "uncertain";
  readonly matchIndex: number;
  readonly matchedText: string;
}

/** Compiles the rule file once at startup; a pattern failing to compile is a
 * startup error, not a runtime skip. */
export function compileSignatures(file: SignaturesFile): CompiledRuleset {
  const signatures = file.signatures.map((rule) => {
    try {
      return { rule, regex: new RegExp(rule.pattern) };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`signature ${rule.pattern_id} failed to compile: ${detail}`);
    }
  });
  return Object.freeze({ version: file.version, signatures });
}

/** Applies every compiled signature to one output text; returns all matches
 * (first occurrence per signature, in rule-file order). Anchoring semantics
 * live in the patterns — this function never substring-matches. */
export function matchSignatures(ruleset: CompiledRuleset, text: string): SignatureMatch[] {
  const out: SignatureMatch[] = [];
  for (const { rule, regex } of ruleset.signatures) {
    const m = regex.exec(text);
    if (m !== null) {
      out.push({
        patternId: rule.pattern_id,
        countsAsFailure: rule.counts_as_failure,
        matchIndex: m.index,
        matchedText: m[0],
      });
    }
  }
  return out;
}
