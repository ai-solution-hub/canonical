import { z } from 'zod';
import type { Json } from '@/supabase/types/database.types';
import { logger } from '@/lib/logger/client';

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

export const ChangeReportDomainSummarySchema = z
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
        summary: z.string().nullable().optional(),
      }),
    ),
    key_themes: z.array(z.string()),
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
    logger.warn({ err: result.error.issues }, 'JSONB parse warning');
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
    domain: z.record(z.string(), z.number().int().nonnegative()).default({}),
    content_type: z
      .record(z.string(), z.number().int().nonnegative())
      .default({}),
    platform: z.record(z.string(), z.number().int().nonnegative()).default({}),
  })
  .strict();

/**
 * Freshness histogram returned as the `freshness_summary` jsonb column of
 * get_dashboard_attention_counts (ID-70). Validated at the consumer boundary
 * (lib/dashboard.ts) via the same parseJsonb pattern as FilterCountsSchema.
 */
export const FreshnessSummarySchema = z.object({
  fresh: z.number().int().nonnegative(),
  aging: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
});

export const AuthorCountSchema = z
  .object({
    author_name: z.string(),
    count: z.number(),
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
