#!/usr/bin/env bun
/**
 * ui-visual-review — adversarial screenshot review via the Gemini API.
 *
 * Sends a UI screenshot + the stated intent to Gemini and asks it to
 * adversarially judge whether the image fulfills the intent. Returns
 * structured JSON on stdout; exit codes carry the verdict so callers can gate.
 *
 * Usage:
 *   bun .claude/skills/ui-visual-review/scripts/review.ts \
 *     --image <path.png|jpg|webp> \
 *     --intent "<what this UI is supposed to show/do>" \
 *     [--context "<extra context: spec excerpt, constraints, palette rules>"] \
 *     [--model gemini-2.5-flash]
 *
 * Env: GEMINI_API_KEY (required)  ·  GEMINI_MODEL (optional default override)
 *
 * Exit codes: 0 = PASS  ·  1 = FAIL (mismatches found)  ·  2 = usage/env error
 *             3 = API/transport error  ·  4 = unparseable model response
 *
 * Constraint (repo convention): this script never fabricates a verdict — any
 * failure to obtain a real model judgment is a loud non-zero exit, never a
 * default PASS.
 */

import { parseArgs } from "node:util";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function die(code: number, msg: string): never {
  console.error(`ui-visual-review: ${msg}`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    image: { type: "string" },
    intent: { type: "string" },
    context: { type: "string", default: "" },
    model: { type: "string" },
  },
});

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) die(2, "GEMINI_API_KEY is not set. This tool requires a real key; it never fabricates a review.");
if (!values.image || !values.intent) die(2, "required: --image <path> and --intent \"<stated intent>\"");

const model = values.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const ext = values.image.split(".").pop()?.toLowerCase() ?? "";
const mime = MIME[ext];
if (!mime) die(2, `unsupported image extension ".${ext}" (supported: ${Object.keys(MIME).join(", ")})`);

const file = Bun.file(values.image);
if (!(await file.exists())) die(2, `image not found: ${values.image}`);
const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");

const REVIEW_PROMPT = `You are an adversarial UI reviewer. You are given a screenshot of a user
interface and a STATED INTENT describing what that UI is supposed to show or do. Your job is to
try to REFUTE the claim that the screenshot fulfills the intent.

Judge only what is visible. Do not give the benefit of the doubt: if an element the intent
requires is not clearly present and correct in the image, that is a mismatch. Also flag anything
visibly broken regardless of the intent (overlapping/clipped text, layout overflow, unreadable
contrast, obviously placeholder content presented as real, empty regions that look like render
failures).

If the image is too small, too blurry, or shows the wrong surface entirely, say so via
"reviewable": false rather than guessing.

STATED INTENT:
${values.intent}
${values.context ? `\nADDITIONAL CONTEXT (constraints/spec excerpts the UI must honor):\n${values.context}\n` : ""}
Respond with JSON only, matching the response schema.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: ["reviewable", "verdict", "summary", "mismatches", "visual_defects"],
  properties: {
    reviewable: { type: "BOOLEAN", description: "false if the image cannot be judged (wrong surface, illegible)" },
    verdict: { type: "STRING", enum: ["pass", "fail"], description: "pass ONLY if every element of the intent is visibly fulfilled" },
    summary: { type: "STRING", description: "one-sentence overall judgment" },
    mismatches: {
      type: "ARRAY",
      description: "each way the screenshot fails the stated intent; empty if none",
      items: {
        type: "OBJECT",
        required: ["claim", "observed", "severity"],
        properties: {
          claim: { type: "STRING", description: "the part of the intent not fulfilled" },
          observed: { type: "STRING", description: "what the image actually shows" },
          severity: { type: "STRING", enum: ["blocker", "major", "minor"] },
        },
      },
    },
    visual_defects: {
      type: "ARRAY",
      description: "visible breakage independent of the intent (clipping, overflow, contrast, render failures)",
      items: { type: "STRING" },
    },
  },
} as const;

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
let res: Response;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: REVIEW_PROMPT }, { inline_data: { mime_type: mime, data: b64 } }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
} catch (e) {
  die(3, `network error calling Gemini: ${e instanceof Error ? e.message : String(e)}`);
}

if (!res.ok) {
  const body = await res.text().catch(() => "");
  die(3, `Gemini API error HTTP ${res.status}: ${body.slice(0, 500)}`);
}

const payload = (await res.json()) as {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};
const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
if (!text) die(4, "empty response from Gemini (no candidate text)");

let review: {
  reviewable: boolean;
  verdict: "pass" | "fail";
  summary: string;
  mismatches: { claim: string; observed: string; severity: string }[];
  visual_defects: string[];
};
try {
  review = JSON.parse(text);
} catch {
  die(4, `Gemini returned non-JSON despite schema constraint:\n${text.slice(0, 800)}`);
}

console.log(JSON.stringify({ model, image: values.image, ...review }, null, 2));

if (!review.reviewable) die(4, "image was not reviewable (see summary above) — retake the screenshot");
process.exit(review.verdict === "pass" ? 0 : 1);
