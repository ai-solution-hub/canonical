/**
 * Grounding-shape declarations for every AI touchpoint in `lib/ai` (B-INV-35).
 *
 * Each touchpoint declares EXACTLY ONE {@link GroundingShape}. The shape is the
 * contract the touchpoint's `messages.create` call must honour:
 *
 *   - `structured_output`  — `output_config.format` with a JSON Schema; no tools.
 *   - `forced_tool_strict` — forced `tool_choice` + a `strict: true` tool whose
 *                            `input_schema` sets `additionalProperties: false`
 *                            recursively.
 *   - `citations`          — `search_result` content blocks with citations
 *                            enabled. NEVER combined with `output_config.format`
 *                            in the same call.
 *   - `n/a`                — no structured/citation grounding (free-form prose,
 *                            or no AI call at all).
 *
 * This module is the single source of truth for the declaration; the touchpoint
 * implementations consume it (each call site references its own entry) so the
 * declared shape and the shape actually used can never drift apart. The
 * {@link GroundingShape} union is owned by ID-104 (`@/lib/eval/contract`) —
 * consumed here via a direct file import, never re-derived.
 */

import type { GroundingShape } from '@/lib/eval/contract';

/**
 * Stable id for each AI touchpoint, namespaced `<module>.<function>`. A single
 * module may host more than one touchpoint (e.g. draft.ts hosts the structured
 * Pass-1 analysis and the citation Pass-2 draft as distinct touchpoints).
 */
export type AiTouchpointId =
  | 'classify.classifyContent'
  | 'classify.classifyText'
  | 'classify.validateEntities'
  | 'draft.analyseQuestion'
  | 'draft.draftResponse'
  | 'quality-check.runAIQualityCheck'
  | 'extract-questions.extractQuestions'
  | 'extract-questions.extractTenderMetadata'
  | 'extract-questions.generateSearchQueries'
  | 'summarise.callSummaryAI'
  | 'extract-content.extractStructuredContent'
  | 'match.assessConfidence'
  | 'vision.analyseVision'
  | 'change-reports.generateChangeReport'
  | 'citation-vision-rasterise.deriveVisionHighlightLive';

/**
 * The canonical grounding shape per touchpoint. The Checker audits each call
 * site against the value here; a touchpoint whose API call does not match its
 * declared shape is a B-INV-35 violation.
 */
export const AI_TOUCHPOINT_GROUNDING: Record<AiTouchpointId, GroundingShape> = {
  // classify.ts — three forced-tool extraction passes.
  'classify.classifyContent': 'forced_tool_strict',
  'classify.classifyText': 'forced_tool_strict',
  'classify.validateEntities': 'forced_tool_strict',

  // draft.ts — the 3-pass split keeps structured Pass 1 separate from citation
  // Pass 2 (Pass 3 is quality-check.ts). Citations and structured outputs are
  // never combined, so these stay distinct touchpoints.
  'draft.analyseQuestion': 'structured_output',
  'draft.draftResponse': 'citations',

  // quality-check.ts — structured score/claims output.
  'quality-check.runAIQualityCheck': 'structured_output',

  // extract-questions.ts — forced-tool extraction for questions, metadata, and
  // search-query generation.
  'extract-questions.extractQuestions': 'forced_tool_strict',
  'extract-questions.extractTenderMetadata': 'forced_tool_strict',
  'extract-questions.generateSearchQueries': 'forced_tool_strict',

  // summarise.ts — forced-tool structured summary.
  'summarise.callSummaryAI': 'forced_tool_strict',

  // extract-content.ts — structured extraction against a caller-supplied schema.
  'extract-content.extractStructuredContent': 'structured_output',

  // match.ts — pure scoring/dedup, no AI call.
  'match.assessConfidence': 'n/a',

  // vision.ts — free-form prose description of a PDF; no structured grounding.
  'vision.analyseVision': 'n/a',

  // change-reports.ts — forced-tool structured digest.
  'change-reports.generateChangeReport': 'forced_tool_strict',

  // citation-vision-rasterise.ts — ID-147 {147.12} B2 vision-fallback citation
  // bounding-box detection (DR-064, PRODUCT §D2 approximate path), live call
  // wired at ID-145 {145.47}. Forced tool_choice + a strict:true, closed
  // (additionalProperties:false) `report_citation_bounding_box` tool.
  'citation-vision-rasterise.deriveVisionHighlightLive': 'forced_tool_strict',
};
