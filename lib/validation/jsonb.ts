import { z } from 'zod';
import type { Json } from '@/supabase/types/database.types';

// ── Read-side schemas ──
// Use .passthrough() to allow extra fields (future-proofing against schema additions)

export const SummaryDataSchema = z
  .object({
    executive: z.string(),
    detailed: z.string(),
    takeaways: z.array(z.string()),
    generated_at: z.string(),
    model: z.string(),
    tokens_used: z.number().optional(),
  })
  .passthrough();

export const TranscriptSegmentSchema = z
  .object({
    id: z.string(),
    chapter_index: z.number(),
    title: z.string(),
    summary: z.string(),
    key_points: z.array(z.string()),
    start_seconds: z.number(),
    end_seconds: z.number(),
    start_time: z.string(),
    end_time: z.string(),
    duration_seconds: z.number(),
    word_count: z.number(),
    read_time_minutes: z.number(),
  })
  .passthrough();

export const TranscriptHighlightSchema = z
  .object({
    id: z.string(),
    quote: z.string(),
    timestamp: z.string(),
    approximate_timestamp: z.number(),
    chapter_index: z.number(),
    category: z.enum([
      'insight',
      'prediction',
      'framework',
      'quote',
      'data_point',
      'action_item',
    ]),
    significance: z.string(),
    context: z.string().optional(),
    starred: z.boolean(),
    created_item_id: z.string().optional(),
  })
  .passthrough();

export const DigestDomainSummarySchema = z
  .object({
    domain: z.string(),
    item_count: z.number(),
    summary: z.string(),
    top_items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        content_type: z.string().optional(),
        why_notable: z.string().optional(),
        ai_summary: z.string().nullable().optional(),
      }),
    ),
    key_themes: z.array(z.string()),
  })
  .passthrough();

export const ThemeClusterSchema = z
  .object({
    theme: z.string(),
    item_count: z.number(),
    description: z.string(),
  })
  .passthrough();

// ── Parse helpers ──

/**
 * Safely parse JSONB data with a Zod schema, returning null on failure.
 * Logs a warning with issue details when validation fails.
 */
export function parseJsonb<T>(schema: z.ZodType<T>, data: unknown): T | null {
  let input = data;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      // Not valid JSON string — fall through to schema validation
    }
  }
  const result = schema.safeParse(input);
  if (!result.success) {
    console.warn('JSONB parse warning:', result.error.issues);
    return null;
  }
  return result.data;
}

/**
 * Parse a JSONB array, filtering out items that fail validation.
 * Returns an empty array if `data` is not an array.
 */
export function parseJsonbArray<T>(schema: z.ZodType<T>, data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => schema.safeParse(item))
    .filter((r): r is z.ZodSafeParseSuccess<T> => r.success)
    .map((r) => r.data);
}

// ── RPC response schemas ──

export const FilterCountsSchema = z
  .object({
    domain: z.record(z.string(), z.number()).optional().default({}),
    content_type: z.record(z.string(), z.number()).optional().default({}),
    platform: z.record(z.string(), z.number()).optional().default({}),
  })
  .passthrough();

export const AuthorCountSchema = z
  .object({
    author_name: z.string(),
    count: z.number(),
  })
  .passthrough();

export const PipelineStatsSchema = z
  .object({
    total_items: z.number(),
    items_7d: z.number(),
    items_30d: z.number(),
    unread_count: z.number(),
    missing_summaries: z.number(),
    missing_embeddings: z.number(),
    has_embedding: z.number(),
    has_summary: z.number(),
    has_thumbnail: z.number(),
    is_classified: z.number(),
    quality_issues_unresolved: z.number(),
    confidence_distribution: z.array(
      z.object({
        confidence_band: z.string(),
        item_count: z.number(),
      }),
    ),
    content_type_breakdown: z.array(
      z.object({
        content_type: z.string(),
        item_count: z.number(),
      }),
    ),
    quality_issues_by_type: z
      .array(
        z.object({
          flag_type: z.string(),
          severity: z.string(),
          issue_count: z.number(),
        }),
      )
      .nullable(),
  })
  .passthrough();

export const ReviewQueueRowSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    suggested_title: z.string().nullable(),
    ai_summary: z.string().nullable(),
    primary_domain: z.string().nullable(),
    primary_subtopic: z.string().nullable(),
    secondary_domain: z.string().nullable(),
    secondary_subtopic: z.string().nullable(),
    content_type: z.string(),
    platform: z.string(),
    author_name: z.string().nullable(),
    source_domain: z.string().nullable(),
    thumbnail_url: z.string().nullable(),
    captured_date: z.string().nullable(),
    ai_keywords: z.array(z.string()).nullable(),
    classification_confidence: z.number().nullable(),
    priority: z.string().nullable(),
    user_tags: z.array(z.string()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    content: z.string().nullable(),
    source_url: z.string().nullable(),
    verified_at: z.string().nullable(),
    verified_by: z.string().nullable(),
  })
  .passthrough();

export const QualityIssueSummarySchema = z
  .object({
    total_unresolved: z.number(),
    total_resolved: z.number(),
    by_severity: z.object({
      error: z.number(),
      warning: z.number(),
      info: z.number(),
    }),
  })
  .passthrough();

export const QualityIssueRowSchema = z
  .object({
    id: z.string(),
    content_item_id: z.string().nullable(),
    flag_type: z.string(),
    severity: z.string(),
    details: z.union([z.record(z.string(), z.unknown()), z.string()]).nullable(),
    resolved: z.boolean(),
    resolved_at: z.string().nullable(),
    resolved_by: z.string().nullable(),
    resolution_notes: z.string().nullable(),
    ingestion_batch: z.string().nullable(),
    source_url: z.string().nullable(),
    created_at: z.string(),
    item_title: z.string().nullable(),
    item_raw_title: z.string().nullable(),
    item_content_type: z.string().nullable(),
    item_platform: z.string().nullable(),
    item_domain: z.string().nullable(),
    item_thumbnail_url: z.string().nullable(),
  })
  .passthrough();

export const QualityIssuesResponseSchema = z
  .object({
    issues: z.array(QualityIssueRowSchema),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    summary: QualityIssueSummarySchema,
  })
  .passthrough();

// ── Write helper ──

/**
 * Cast an application type to Supabase's Json type for writes.
 * Centralises the `as unknown as Json` cast in one place.
 */
export function toJson<T>(data: T): Json {
  return data as unknown as Json;
}
