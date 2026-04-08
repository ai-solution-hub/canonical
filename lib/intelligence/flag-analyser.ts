// lib/intelligence/flag-analyser.ts
//
// Claude-backed analysis of feed flag patterns. Takes the current scoring
// prompt + a list of flagged articles + company context and returns a
// structured set of pattern clusters and prompt-refinement recommendations.
//
// This is the core of the SI Prompt Refinement Skill (spec:
// docs/specs/si-prompt-refinement-skill-spec.md §4 Task 2 + §5).

import { z } from 'zod';
import { getAnthropicClient, getModelForTier } from '@/lib/anthropic';
import type { CompanyContext } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum number of flags analysed per call. The spec caps at 50; if more
 *  flags are supplied we truncate to the most-recent 50 and surface a
 *  `truncated` flag on the result so the caller can warn the user. */
export const MAX_FLAGS_PER_ANALYSIS = 50;

/** Max output tokens for the analysis call. The analysis can be lengthy when
 *  many flags are present (multiple pattern clusters + a full revised prompt
 *  text), so 4096 matches the spec's recommended ceiling. */
const ANALYSIS_MAX_TOKENS = 4096;

/** Temperature 0 — deterministic analysis, not creative generation. The same
 *  set of flags should always yield the same recommendations so the user can
 *  re-run analysis without surprise. */
const ANALYSIS_TEMPERATURE = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Input shape
// ─────────────────────────────────────────────────────────────────────────────

/** A single flagged article passed into the analyser. */
export interface FlagAnalysisFlag {
  flagType: 'false_positive' | 'false_negative';
  articleTitle: string;
  articleUrl: string;
  relevanceScore: number;
  relevanceReasoning: string;
  relevanceCategory: string;
  userNotes: string | null;
  sourceName: string;
  /** ISO timestamp — used for "most recent 50" truncation when over the cap. */
  createdAt: string;
}

export interface FlagAnalysisInput {
  currentPromptText: string;
  flags: FlagAnalysisFlag[];
  companyContext: CompanyContext;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output schema (Zod) — single source of truth for the result shape
// ─────────────────────────────────────────────────────────────────────────────

/** Cluster of flagged articles sharing a common root cause. */
export const PatternClusterSchema = z.object({
  pattern: z.string().min(1),
  articleCount: z.number().int().nonnegative(),
  articles: z.array(z.string()),
  rootCause: z.string().min(1),
});

export type PatternCluster = z.infer<typeof PatternClusterSchema>;

/** A single proposed change to the scoring prompt. */
export const PromptRecommendationSchema = z.object({
  type: z.enum(['add', 'remove', 'reword']),
  section: z.string().min(1),
  /** `null` for additions; original text for `remove` / `reword`. */
  currentText: z.string().nullable(),
  proposedText: z.string().min(1),
  reasoning: z.string().min(1),
  affectedFlags: z.number().int().nonnegative(),
});

export type PromptRecommendation = z.infer<typeof PromptRecommendationSchema>;

/** Full structured analysis result. */
export const FlagAnalysisResultSchema = z.object({
  summary: z.string().min(1),
  falsePositivePatterns: z.array(PatternClusterSchema),
  falseNegativePatterns: z.array(PatternClusterSchema),
  recommendations: z.array(PromptRecommendationSchema),
  /** Full revised prompt text (must be a complete prompt, not a fragment). */
  proposedPromptText: z.string(),
  confidenceNotes: z.string(),
  /** Number of flags actually analysed (<= MAX_FLAGS_PER_ANALYSIS). */
  analysedFlagCount: z.number().int().nonnegative(),
  /** True when the input contained more than MAX_FLAGS_PER_ANALYSIS flags. */
  truncated: z.boolean(),
});

export type FlagAnalysisResult = z.infer<typeof FlagAnalysisResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/** Domain error for any failure inside `analyseFeedFlags`.
 *
 *  Wraps three distinct failure modes:
 *    - `cause: 'api'`     — Claude API call failed (network, 5xx, 429, etc.)
 *    - `cause: 'parse'`   — Response was not valid JSON
 *    - `cause: 'schema'`  — JSON shape did not satisfy `FlagAnalysisResultSchema`
 *
 *  Callers should catch this and surface a friendly message to the user; the
 *  underlying cause + raw response are preserved for logs / Sentry.
 */
export class FlagAnalysisError extends Error {
  readonly cause: 'api' | 'parse' | 'schema';
  readonly originalError: unknown;
  readonly rawResponse: string | null;

  constructor(
    message: string,
    cause: 'api' | 'parse' | 'schema',
    options: { originalError?: unknown; rawResponse?: string | null } = {},
  ) {
    super(message);
    this.name = 'FlagAnalysisError';
    this.cause = cause;
    this.originalError = options.originalError;
    this.rawResponse = options.rawResponse ?? null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt construction
// ─────────────────────────────────────────────────────────────────────────────

/** Format a single flag as a short text block for the Claude prompt. Mirrors
 *  the format documented in the spec §5 "Flagged article formatting". */
function formatFlag(flag: FlagAnalysisFlag): string {
  const notes = flag.userNotes && flag.userNotes.trim().length > 0
    ? flag.userNotes
    : 'No notes provided';
  return [
    `[${flag.flagType}] "${flag.articleTitle}"`,
    `  Source: ${flag.sourceName}`,
    `  Score: ${flag.relevanceScore} (${flag.relevanceCategory})`,
    `  AI reasoning: ${flag.relevanceReasoning}`,
    `  User notes: ${notes}`,
  ].join('\n');
}

/** Build the system prompt sent to Claude. Mirrors spec §5 verbatim so the
 *  prompt design is co-located with the contract Claude is asked to honour. */
export function buildAnalysisSystemPrompt(
  company: CompanyContext,
  currentPromptText: string,
  flags: FlagAnalysisFlag[],
): string {
  const flaggedArticlesFormatted = flags.map(formatFlag).join('\n\n');

  return `You are an intelligence filtering analyst. Your task is to analyse feedback flags on an AI-powered article filtering system and recommend improvements to the scoring prompt.

## Context

A company uses an AI system to filter news articles for business relevance. Articles are scored 0.0-1.0 and those above a threshold (typically 0.5) are surfaced to the team. The team flags incorrect decisions:
- **False positive**: article passed the filter but should not have (irrelevant)
- **False negative**: article was filtered out but should have passed (relevant)

## Company context

Name: ${company.name}
Sectors: ${company.sectors.join(', ')}
Services: ${company.services.join(', ')}
Key topics: ${company.keyTopics.join(', ')}
Target customers: ${company.targetCustomers ?? 'Not specified'}
Value proposition: ${company.valueProposition ?? 'Not specified'}

## Current scoring prompt

${currentPromptText}

## Flagged articles

${flaggedArticlesFormatted}

## Your task

Analyse the flagged articles and recommend specific changes to the scoring prompt. Your analysis must include:

1. **Pattern clustering**: Group the flags into patterns. For example, "4 false positives are about school building projects -- the prompt is too broad on education topics" or "3 false negatives are about CQC inspection changes -- the prompt does not mention CQC explicitly."

2. **Root cause identification**: For each pattern, identify which specific part of the current prompt caused the incorrect scoring decision.

3. **Recommendations**: Propose specific text changes to the prompt. Each recommendation must specify:
   - Whether to add, remove, or reword text
   - The exact section and text affected
   - The proposed new text
   - How many flagged articles this change would address

4. **Revised prompt**: Provide the complete revised prompt text incorporating all recommendations. This must be a valid, complete scoring prompt -- not a fragment or diff.

5. **Confidence notes**: Note any caveats. For example, "Only 3 flags were available, so patterns may not be reliable" or "The false negatives suggest adding a broad category that may increase false positives."

## Output format

Respond with JSON only:
{
  "summary": "2-3 sentence overview of findings",
  "false_positive_patterns": [
    {
      "pattern": "Description of the pattern",
      "article_count": N,
      "articles": ["Article title 1", "Article title 2"],
      "root_cause": "Why the current prompt causes this"
    }
  ],
  "false_negative_patterns": [],
  "recommendations": [
    {
      "type": "add|remove|reword",
      "section": "Which section of the prompt",
      "current_text": "Text being changed (null for additions)",
      "proposed_text": "Replacement or new text",
      "reasoning": "Why this change addresses the flags",
      "affected_flags": N
    }
  ],
  "proposed_prompt_text": "The complete revised prompt",
  "confidence_notes": "Caveats and limitations"
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON normalisation
// ─────────────────────────────────────────────────────────────────────────────

/** Strip markdown code fences a model may wrap around its JSON response. */
function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

/** Convert the snake_case JSON Claude returns into the camelCase shape the
 *  Zod schema enforces. Anything missing falls through and trips Zod. */
function normaliseAnalysisJson(parsed: unknown, analysedFlagCount: number, truncated: boolean): unknown {
  if (parsed === null || typeof parsed !== 'object') return parsed;
  const obj = parsed as Record<string, unknown>;

  const mapPatterns = (raw: unknown): unknown => {
    if (!Array.isArray(raw)) return raw;
    return raw.map((entry) => {
      if (entry === null || typeof entry !== 'object') return entry;
      const e = entry as Record<string, unknown>;
      return {
        pattern: e.pattern,
        articleCount: e.article_count ?? e.articleCount,
        articles: e.articles,
        rootCause: e.root_cause ?? e.rootCause,
      };
    });
  };

  const mapRecommendations = (raw: unknown): unknown => {
    if (!Array.isArray(raw)) return raw;
    return raw.map((entry) => {
      if (entry === null || typeof entry !== 'object') return entry;
      const e = entry as Record<string, unknown>;
      // Coerce explicit "null" string (some models return that) into null.
      const rawCurrent = e.current_text ?? e.currentText;
      const currentText =
        typeof rawCurrent === 'string' && rawCurrent.toLowerCase() === 'null'
          ? null
          : (rawCurrent ?? null);
      return {
        type: e.type,
        section: e.section,
        currentText,
        proposedText: e.proposed_text ?? e.proposedText,
        reasoning: e.reasoning,
        affectedFlags: e.affected_flags ?? e.affectedFlags,
      };
    });
  };

  return {
    summary: obj.summary,
    falsePositivePatterns: mapPatterns(
      obj.false_positive_patterns ?? obj.falsePositivePatterns ?? [],
    ),
    falseNegativePatterns: mapPatterns(
      obj.false_negative_patterns ?? obj.falseNegativePatterns ?? [],
    ),
    recommendations: mapRecommendations(obj.recommendations ?? []),
    proposedPromptText:
      obj.proposed_prompt_text ?? obj.proposedPromptText ?? '',
    confidenceNotes: obj.confidence_notes ?? obj.confidenceNotes ?? '',
    analysedFlagCount,
    truncated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Empty / "no work to do" result for the zero-flags case. Returned without
 *  ever calling Claude — saves cost and surfaces a clear message in the UI. */
function emptyResult(): FlagAnalysisResult {
  return {
    summary: 'No unresolved flags to analyse.',
    falsePositivePatterns: [],
    falseNegativePatterns: [],
    recommendations: [],
    proposedPromptText: '',
    confidenceNotes:
      'No flags supplied to the analyser; the prompt was not modified.',
    analysedFlagCount: 0,
    truncated: false,
  };
}

/**
 * Analyse a set of feed flags and recommend changes to the scoring prompt.
 *
 * - 0 flags → returns a structured "no refinement needed" result without
 *   touching Claude.
 * - >50 flags → truncates to the 50 most recent (by `createdAt`) and sets
 *   `truncated: true` on the result.
 * - Mixed FP / FN → both groups are analysed; pattern clusters are kept
 *   separate so the UI can render each side independently.
 *
 * Throws `FlagAnalysisError` on Claude API failure, JSON parse failure, or
 * Zod schema validation failure. Never returns a partial / unsafe result.
 */
export async function analyseFeedFlags(
  input: FlagAnalysisInput,
): Promise<FlagAnalysisResult> {
  // 0-flag short circuit — no API call required.
  if (input.flags.length === 0) {
    return emptyResult();
  }

  // Sort by createdAt desc and take the most recent N. The spec mandates
  // the 50-flag cap to keep prompt size manageable and to keep cost bounded.
  const sortedDesc = [...input.flags].sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    // NaN-safe — articles with unparseable timestamps sort last.
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    return bTime - aTime;
  });

  const truncated = sortedDesc.length > MAX_FLAGS_PER_ANALYSIS;
  const flagsForAnalysis = truncated
    ? sortedDesc.slice(0, MAX_FLAGS_PER_ANALYSIS)
    : sortedDesc;

  // Model selection — pinned to the `analysis` tier (Claude Sonnet).
  //
  // Why this tier:
  // The spec (§4 Task 2) calls for `getModelForTier('default')` and Claude
  // Sonnet specifically. The S154 WP1 spec audit
  // (docs/audits/s154-si-prompt-refinement-spec-review.md §4 tertiary obs 1)
  // flagged that the spec did not pin the tier explicitly. We pin the
  // `analysis` tier here because:
  //   1. This is moderate-complexity reasoning over structured input — Haiku
  //      (the `quality` tier) lacks the nuance for prompt-engineering
  //      analysis, and Opus (the `drafting` tier) is unnecessarily expensive
  //      for an infrequent operation (1-2 runs/week).
  //   2. The current `analysis` tier maps to Claude Sonnet
  //      (see lib/anthropic.ts MODEL_MAP), matching the spec's intent.
  //   3. There is no `'default'` tier on `getModelForTier`; the spec wording
  //      was aspirational. `'analysis'` is the closest existing tier.
  // If the model map changes in future, this comment + the call below should
  // be revisited so the analyser still lands on a Sonnet-class model.
  const model = getModelForTier('analysis');

  const systemPrompt = buildAnalysisSystemPrompt(
    input.companyContext,
    input.currentPromptText,
    flagsForAnalysis,
  );

  // Call Claude. Any error here surfaces as `FlagAnalysisError` with cause
  // 'api' so callers can distinguish API failures from validation failures.
  let rawText: string;
  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model,
      max_tokens: ANALYSIS_MAX_TOKENS,
      temperature: ANALYSIS_TEMPERATURE,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content:
            'Analyse the flagged articles above and respond with the JSON object specified in the system prompt. Respond with JSON only — no preamble, no code fences, no commentary.',
        },
      ],
    });

    const firstBlock = response.content[0];
    rawText =
      firstBlock && firstBlock.type === 'text' ? firstBlock.text : '';
  } catch (err) {
    throw new FlagAnalysisError(
      `Claude API call failed during flag analysis: ${err instanceof Error ? err.message : String(err)}`,
      'api',
      { originalError: err },
    );
  }

  // Parse JSON. Strip code fences first in case the model wraps the response.
  const cleaned = stripCodeFences(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new FlagAnalysisError(
      `Flag analysis response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      'parse',
      { originalError: err, rawResponse: rawText },
    );
  }

  // Normalise snake_case → camelCase, then validate via Zod.
  const normalised = normaliseAnalysisJson(
    parsed,
    flagsForAnalysis.length,
    truncated,
  );

  const validation = FlagAnalysisResultSchema.safeParse(normalised);
  if (!validation.success) {
    throw new FlagAnalysisError(
      `Flag analysis response failed schema validation: ${validation.error.message}`,
      'schema',
      { originalError: validation.error, rawResponse: rawText },
    );
  }

  return validation.data;
}
