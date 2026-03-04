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

/** POST /api/items/[id]/rollback */
export const RollbackBodySchema = z.object({
  version_id: z.string().uuid('version_id must be a valid UUID'),
});

/** POST /api/governance (create/update governance config) */
export const GovernanceConfigBodySchema = z.object({
  domain: z.string().trim().min(1, 'Domain is required').max(200),
  posture: z.enum(['open', 'review_on_change']),
  reviewer_id: z.string().uuid('reviewer_id must be a valid UUID').nullable().optional(),
  timeout_days: z.number().int().min(1).max(365).nullable().optional(),
});

/** POST /api/governance/review */
export const GovernanceReviewBodySchema = z.object({
  item_id: z.string().uuid('item_id must be a valid UUID'),
  action: z.enum(['approve', 'request_changes', 'revert']),
  notes: z.string().max(1000).optional(),
});

/** POST /api/freshness/calculate */
export const FreshnessCalculateBodySchema = z.object({
  item_ids: z.array(z.string().uuid()).min(1).max(500),
});

/** POST /api/notifications/read */
export const NotificationReadBodySchema = z.object({
  notification_ids: z.array(z.string().uuid()).min(1).max(100),
});

/** POST /api/extract */
export const ExtractBodySchema = z.object({
  itemId: z.string().uuid('itemId must be a valid UUID'),
  schema: z.record(z.string(), z.unknown()),
  prompt: z.string().max(5000).optional(),
});

// ──────────────────────────────────────────
// Bid Infrastructure Schemas (Phase 6A)
// ──────────────────────────────────────────

/** POST /api/bids */
export const BidCreateBodySchema = z.object({
  name: z.string().trim().min(1, 'Bid name is required').max(200),
  description: z.string().max(2000).optional(),
  buyer: z.string().trim().min(1, 'Buyer name is required').max(200),
  deadline: z.string().datetime({ offset: true }).optional(),
  reference_number: z.string().max(100).optional(),
  estimated_value: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
});

/** PATCH /api/bids/:id */
export const BidUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  buyer: z.string().trim().min(1).max(200).optional(),
  deadline: z.string().datetime({ offset: true }).nullable().optional(),
  reference_number: z.string().max(100).nullable().optional(),
  estimated_value: z.string().max(100).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  status: z.enum([
    'draft', 'questions_extracted', 'matching', 'drafting',
    'in_review', 'ready_for_export', 'submitted', 'won', 'lost', 'withdrawn',
  ]).optional(),
  submission_date: z.string().datetime({ offset: true }).optional(),
  outcome: z.enum(['won', 'lost', 'withdrawn']).optional(),
  outcome_notes: z.string().max(5000).optional(),
});

/** POST /api/bids/:id/questions/extract */
export const QuestionExtractBodySchema = z.object({
  document_path: z.string().min(1, 'Document path is required'),
  format: z.enum(['docx', 'pdf']),
});

/** POST /api/bids/:id/questions */
// NOTE: evaluation_weight is capped at 100 by Zod (for percentage weights),
// which is intentionally stricter than the DB column NUMERIC(5,2) max of 999.99.
export const QuestionCreateBodySchema = z.object({
  section_name: z.string().max(200).optional(),
  question_text: z.string().trim().min(1, 'Question text is required').max(5000),
  word_limit: z.number().int().min(1).max(100000).optional(),
  evaluation_weight: z.number().min(0).max(100).optional(),
});

/** PATCH /api/bids/:id/questions/:qId */
export const QuestionUpdateBodySchema = z.object({
  section_name: z.string().max(200).nullable().optional(),
  question_text: z.string().trim().min(1).max(5000).optional(),
  word_limit: z.number().int().min(1).max(100000).nullable().optional(),
  evaluation_weight: z.number().min(0).max(100).nullable().optional(),
  section_sequence: z.number().int().min(0).optional(),
  question_sequence: z.number().int().min(0).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
});

/** POST /api/bids/:id/questions/match */
export const QuestionMatchBodySchema = z.object({
  question_ids: z.array(z.string().uuid()).optional(),
  force: z.boolean().default(false),
});

// ──────────────────────────────────────────
// Bid Response Schemas (Phase 6B)
// ──────────────────────────────────────────

/** POST /api/bids/:id/responses/draft */
export const ResponseDraftBodySchema = z.object({
  question_ids: z.array(z.string().uuid()).optional(),
  model_tier: z.enum(['analysis', 'drafting']).default('drafting'),
  force: z.boolean().default(false),
});

/** POST /api/bids/:id/responses/draft-all */
export const ResponseDraftAllBodySchema = z.object({
  model_tier: z.enum(['analysis', 'drafting']).default('drafting'),
  skip_existing: z.boolean().default(true),
});

/** PATCH /api/bids/:id/responses/:rId */
export const ResponseUpdateBodySchema = z.object({
  response_text: z.string().max(100000).optional(),
  response_text_advanced: z.string().max(100000).nullable().optional(),
  review_status: z.enum(['draft', 'ai_drafted', 'edited', 'approved', 'needs_review']).optional(),
});

/** POST /api/bids/:id/responses/:rId/regenerate */
export const ResponseRegenerateBodySchema = z.object({
  instructions: z.string().trim().min(1).max(2000),
  model_tier: z.enum(['analysis', 'drafting']).default('drafting'),
});

/** POST /api/bids/:id/outcome */
export const BidOutcomeBodySchema = z.object({
  outcome: z.enum(['won', 'lost', 'withdrawn']),
  notes: z.string().max(5000).optional(),
  integrate_to_kb: z.boolean().default(false),
});

/** POST /api/bids/:id/outcome/integrate */
export const KBIntegrationBodySchema = z.object({
  integrations: z.array(z.object({
    question_id: z.string().uuid(),
    action: z.enum(['new_entry', 'update_existing', 'skip']),
    target_content_id: z.string().uuid().nullable().optional(),
    title: z.string().max(500).optional(),
    content_type: z.enum(['q_a_pair', 'case_study', 'policy', 'methodology', 'capability']).optional(),
  })),
});

// ──────────────────────────────────────────
// Bid Export Schemas (Phase 7A)
// ──────────────────────────────────────────

/** POST /api/bids/:id/export/docx */
export const DocxExportBodySchema = z.object({
  include_cover: z.boolean().default(true),
  include_toc: z.boolean().default(true),
  include_citations: z.boolean().default(true),
  include_unanswered: z.boolean().default(true),
  use_advanced_variant: z.boolean().default(false),
  company_name: z.string().max(200).default('Knowledge Hub'),
});

/** POST /api/bids/:id/export/xlsx */
export const XlsxExportBodySchema = z.object({
  include_summary: z.boolean().default(true),
  include_unanswered: z.boolean().default(true),
  use_advanced_variant: z.boolean().default(false),
});
