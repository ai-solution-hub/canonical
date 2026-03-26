import { z } from 'zod';

// ──────────────────────────────────────────
// AI Tool-Use Response Schemas
// ──────────────────────────────────────────
// Zod schemas for validating Claude AI responses returned via tool-use mode.
// Each schema mirrors the `input_schema` passed to Claude in the corresponding
// API route's tool definition.

/**
 * Schema for the `return_summary` tool response.
 * Used by: POST /api/summaries/generate, scripts/batch_generate_summaries.ts
 */
export const SummaryResponseSchema = z.object({
  executive: z.string(),
  detailed: z.string(),
  takeaways: z.array(z.string()),
});

export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;

/**
 * Schema for a single domain summary within the digest response.
 */
const DigestDomainSummaryResponseSchema = z.object({
  domain: z.string(),
  summary: z.string(),
  key_themes: z.array(z.string()),
  top_items: z.array(
    z.object({
      id: z.string(),
      why_notable: z.string(),
    }),
  ),
});

/**
 * Schema for a single content opportunity within the digest response.
 */
const DigestContentOpportunitySchema = z.object({
  domain: z.string(),
  subtopic: z.string(),
  suggestion: z.string(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
});

/**
 * Schema for the `return_digest` tool response.
 * Used by: POST /api/digest/generate
 */
export const DigestResponseSchema = z.object({
  domain_summaries: z.array(DigestDomainSummaryResponseSchema),
  narrative_summary: z.string(),
  theme_clusters: z.array(
    z.object({
      theme: z.string(),
      description: z.string(),
      item_count: z.number(),
    }),
  ),
  content_opportunities: z.array(DigestContentOpportunitySchema).optional(),
});

export type DigestResponse = z.infer<typeof DigestResponseSchema>;

/**
 * Schema for a single chapter analysis within the segments response.
 */
const ChapterAnalysisResponseSchema = z.object({
  chapter_index: z.number(),
  summary: z.string(),
  key_points: z.array(z.string()),
});

/**
 * Schema for the `return_segments` tool response.
 * Used by: POST /api/transcripts/segment
 */
export const SegmentsResponseSchema = z.object({
  chapters: z.array(ChapterAnalysisResponseSchema),
});

export type SegmentsResponse = z.infer<typeof SegmentsResponseSchema>;

/**
 * Valid highlight categories as defined in the tool schema prompt.
 */
const HIGHLIGHT_CATEGORIES = [
  'insight',
  'prediction',
  'framework',
  'quote',
  'data_point',
  'action_item',
] as const;

/**
 * Schema for a single highlight within the highlights response.
 * chapter_index, approximate_timestamp, and category are optional in the tool
 * schema (not listed in `required`), so they are marked optional here too.
 */
const HighlightItemResponseSchema = z.object({
  quote: z.string(),
  context: z.string(),
  significance: z.string(),
  chapter_index: z.number().optional(),
  approximate_timestamp: z.number().optional(),
  category: z.enum(HIGHLIGHT_CATEGORIES).optional(),
});

/**
 * Schema for the `return_highlights` tool response.
 * Used by: POST /api/transcripts/highlights
 */
export const HighlightsResponseSchema = z.object({
  highlights: z.array(HighlightItemResponseSchema),
});

export type HighlightsResponse = z.infer<typeof HighlightsResponseSchema>;
