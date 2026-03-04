import { z } from 'zod';

// ──────────────────────────────────────────
// Shared enums / constants
// ──────────────────────────────────────────

export const VALID_CONTENT_TYPES = [
  'post',
  'article',
  'blog',
  'pdf',
  'product-page',
  'podcast',
  'video',
  'comment',
  'newsletter',
  'bookmark',
  'transcript',
  'note',
  'course',
  'research',
  'other',
  'q_a_pair',
  'case_study',
  'policy',
  'certification',
  'compliance',
  'methodology',
  'capability',
  'product_description',
] as const;

export const VALID_PLATFORMS = [
  'web',
  'email',
  'manual',
  'upload',
  'extraction',
  'other',
] as const;

export const VALID_SORT_FIELDS = [
  'captured_date',
  'classification_confidence',
  'primary_domain',
] as const;

export const VALID_SORT_ORDERS = ['asc', 'desc'] as const;

export const VALID_REVIEW_ACTIONS = [
  'verify',
  'flag',
  'skip',
  'unverify',
] as const;

export const VALID_REVIEW_STATUSES = [
  'unverified',
  'verified',
  'flagged',
  'all',
] as const;

export const VALID_DIGEST_TYPES = ['weekly', 'daily', 'custom'] as const;

// ──────────────────────────────────────────
// API Route Schemas
// ──────────────────────────────────────────

/** POST /api/search */
export const SearchBodySchema = z.object({
  query: z.string().trim().min(1, 'Query is required').max(2000),
  threshold: z.number().min(0).max(1).default(0.35),
  limit: z.number().int().min(1).max(100).default(20),
});

/** POST /api/embed */
export const EmbedBodySchema = z.object({
  text: z.string().trim().min(1, 'Text is required').max(100_000),
});

/** POST /api/review/action */
export const ReviewActionBodySchema = z.object({
  item_id: z.string().uuid('item_id must be a valid UUID'),
  action: z.enum(VALID_REVIEW_ACTIONS),
  flag_details: z.string().max(500).optional(),
});

/** GET /api/review/queue */
export const ReviewQueueParamsSchema = z.object({
  status: z.enum(VALID_REVIEW_STATUSES).default('unverified'),
  domain: z.array(z.string()).optional(),
  content_type: z.array(z.string()).optional(),
  source_file: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

/** POST /api/summaries/generate */
export const SummaryGenerateBodySchema = z.object({
  item_id: z.string().uuid('item_id must be a valid UUID'),
  force: z.boolean().optional(),
});

/** POST /api/transcripts/highlights */
export const HighlightsGenerateBodySchema = z.object({
  item_id: z.string().uuid('item_id must be a valid UUID'),
  force: z.boolean().optional(),
});

/** POST /api/transcripts/highlights/star */
export const HighlightStarBodySchema = z.object({
  item_id: z.string().uuid('item_id must be a valid UUID'),
  highlight_id: z.string().uuid('highlight_id must be a valid UUID'),
  starred: z.boolean(),
});

/** POST /api/transcripts/segment */
export const SegmentGenerateBodySchema = z.object({
  item_id: z.string().uuid('item_id must be a valid UUID'),
  force: z.boolean().optional(),
});

/** POST /api/digest/generate */
export const DigestGenerateBodySchema = z.object({
  period_days: z.number().int().min(1).max(90).default(7),
  digest_type: z.enum(VALID_DIGEST_TYPES).default('weekly'),
  domain: z.string().optional(),
  keywords: z.array(z.string().trim().min(1)).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
});

/** GET /api/digest/list */
export const DigestListParamsSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
});

/** POST /api/read-marks */
export const ReadMarkBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('mark_read'),
    item_id: z.string().uuid('item_id must be a valid UUID'),
    source: z.enum(['manual', 'review', 'digest', 'bulk']).default('manual'),
  }),
  z.object({
    action: z.literal('mark_unread'),
    item_id: z.string().uuid('item_id must be a valid UUID'),
  }),
  z.object({
    action: z.literal('mark_bulk_read'),
    item_ids: z.array(z.string().uuid()).min(1).max(500),
    source: z.enum(['manual', 'review', 'digest', 'bulk']).default('bulk'),
  }),
]);

/** PATCH /api/items/:id */
export const ItemUpdateBodySchema = z.object({
  field: z.enum([
    'suggested_title',
    'ai_keywords',
    'primary_domain',
    'primary_subtopic',
    'secondary_domain',
    'secondary_subtopic',
    'ai_summary',
    'author_name',
    'content_type',
    'platform',
    'priority',
    'user_tags',
  ]),
  value: z.union([
    z.string().max(5000),
    z.array(z.string().max(100)),
    z.null(),
  ]),
});

/** POST /api/projects */
export const ProjectCreateBodySchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(200),
  description: z.string().max(2000).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour')
    .optional(),
  icon: z.string().max(50).optional(),
});

/** PATCH /api/projects/[id] */
export const ProjectUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour')
    .optional(),
  icon: z.string().max(50).optional(),
  is_archived: z.boolean().optional(),
});

/** POST /api/items/[id]/projects */
export const ItemProjectBodySchema = z.object({
  project_id: z.string().uuid('project_id must be a valid UUID'),
  action: z.enum(['assign', 'unassign']),
});

// ──────────────────────────────────────────
// Quality Issues
// ──────────────────────────────────────────

export const VALID_FLAG_TYPES = [
  'missing_thumbnail',
  'short_content',
  'missing_date',
  'duplicate_candidate',
  'scrape_failed',
  'encoding_issue',
  'missing_author',
  'classification_low',
  'manual_review',
  'dead_letter',
] as const;

export const VALID_SEVERITIES = ['info', 'warning', 'error'] as const;

export const VALID_RESOLUTION_REASONS = [
  'fixed',
  'accepted',
  'ignored',
  'deleted',
] as const;

/** GET /api/pipeline/quality */
export const QualityIssueQuerySchema = z.object({
  flag_type: z.enum(VALID_FLAG_TYPES).nullable().optional(),
  severity: z.enum(VALID_SEVERITIES).nullable().optional(),
  resolved: z.enum(['true', 'false', 'all']).optional().default('false'),
  sort: z.enum(['created_at', 'severity', 'flag_type']).optional().default('created_at'),
  dir: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/** PATCH /api/pipeline/quality/[id] */
export const QualityResolveBodySchema = z.object({
  resolved: z.boolean(),
  resolution_reason: z.enum(VALID_RESOLUTION_REASONS),
  resolution_notes: z.string().max(1000).optional().default(''),
});

/** POST /api/pipeline/quality/bulk */
export const QualityBulkActionSchema = z.object({
  action: z.enum(['resolve', 'delete']),
  ids: z.array(z.string().uuid()).min(1).max(100),
  resolution_reason: z.enum(VALID_RESOLUTION_REASONS).optional(),
  resolution_notes: z.string().max(1000).optional().default(''),
}).refine(
  (data) => data.action !== 'resolve' || data.resolution_reason != null,
  { message: 'resolution_reason is required when action is resolve' }
);

// ──────────────────────────────────────────
// Inline Editing Allowlist
// ──────────────────────────────────────────

/**
 * Fields that can be edited via the item detail inline editor.
 * Any field not in this set will be rejected by saveEdit/updateField.
 */
export const EDITABLE_FIELDS = new Set([
  'suggested_title',
  'ai_keywords',
  'primary_domain',
  'primary_subtopic',
  'secondary_domain',
  'secondary_subtopic',
  'ai_summary',
  'author_name',
  'content_type',
  'platform',
  'priority',
  'user_tags',
] as const);

export type EditableField =
  | 'suggested_title'
  | 'ai_keywords'
  | 'primary_domain'
  | 'primary_subtopic'
  | 'secondary_domain'
  | 'secondary_subtopic'
  | 'ai_summary'
  | 'author_name'
  | 'content_type'
  | 'platform'
  | 'priority'
  | 'user_tags';

export function validateEditableField(field: string): field is EditableField {
  return EDITABLE_FIELDS.has(field as EditableField);
}

// ──────────────────────────────────────────
// Structured Extraction
// ──────────────────────────────────────────

/** POST /api/extract */
export const ExtractBodySchema = z.object({
  itemId: z.string().uuid('itemId must be a valid UUID'),
  schema: z.record(z.string(), z.unknown()),
  prompt: z.string().max(5000).optional(),
});
