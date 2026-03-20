import { z } from 'zod';

// ──────────────────────────────────────────
// Shared enums / constants
// ──────────────────────────────────────────

export const VALID_CONTENT_TYPES = [
  'article',
  'blog',
  'pdf',
  'note',
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
  'unflag',
] as const;

export const VALID_REVIEW_STATUSES = [
  'unverified',
  'verified',
  'flagged',
  'draft',
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
  layer: z.string().max(50).optional(),
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

/** GET /api/review/queue — validates status, limit, cursor only.
 *  Domain, content_type, and source_file are parsed separately via
 *  searchParams.getAll() in the route handler for proper array handling. */
export const ReviewQueueParamsSchema = z.object({
  status: z.enum(VALID_REVIEW_STATUSES).default('unverified'),
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

/** GET /api/read-marks?item_ids=uuid1,uuid2,... */
export const ReadMarkCheckParamsSchema = z.object({
  item_ids: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(200)),
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

/** POST /api/items -- create new content item */
export const ItemCreateBodySchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500),
  content: z.string().min(1, 'Content is required').max(500_000),
  content_type: z.enum(VALID_CONTENT_TYPES),

  // Optional metadata
  primary_domain: z.string().max(200).optional(),
  primary_subtopic: z.string().max(200).optional(),
  secondary_domain: z.string().max(200).optional(),
  secondary_subtopic: z.string().max(200).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  user_tags: z.array(z.string().max(100)).max(50).optional(),
  ai_keywords: z.array(z.string().max(100)).max(50).optional(),
  author_name: z.string().max(200).optional(),
  source_url: z.string().url().max(2000).optional(),

  // Progressive depth (optional)
  brief: z.string().max(5000).optional(),
  detail: z.string().max(50_000).optional(),
  reference: z.string().max(50_000).optional(),

  // AI options
  auto_classify: z.boolean().default(true),
  auto_summarise: z.boolean().default(true),
  auto_embed: z.boolean().default(true),

  // Governance
  governance_review_status: z.enum(['draft']).optional(),

  // Ingestion source tracking
  ingestion_source: z.enum(['manual', 'copilotkit', 'upload', 'url_import']).optional(),
});

/** POST /api/items/:id/classify -- on-demand classification */
export const ClassifyBodySchema = z.object({
  force: z.boolean().default(false),
});

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
    'content',
    'brief',
    'detail',
    'reference',
    'answer_standard',
    'answer_advanced',
    'governance_review_status',
  ]),
  value: z.union([
    z.string().max(500_000),
    z.array(z.string().max(100)),
    z.null(),
  ]),
  // Optional flags for content updates
  regenerate_embedding: z.boolean().optional(),
  reclassify: z.boolean().optional(),
}).superRefine((data, ctx) => {
  // Reject null for NOT NULL columns
  const NOT_NULL_FIELDS = ['content', 'suggested_title'];
  if (data.value === null && NOT_NULL_FIELDS.includes(data.field)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Field '${data.field}' cannot be null`,
      path: ['value'],
    });
  }
  // Enforce field-specific max lengths
  const LONG_TEXT_FIELDS = ['content', 'brief', 'detail', 'reference', 'answer_standard', 'answer_advanced'];
  if (typeof data.value === 'string' && !LONG_TEXT_FIELDS.includes(data.field)) {
    if (data.value.length > 5_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value for field '${data.field}' must be at most 5,000 characters`,
        path: ['value'],
      });
    }
  }
});

/** POST /api/workspaces */
export const WorkspaceCreateBodySchema = z.object({
  name: z.string().trim().min(1, 'Workspace name is required').max(200),
  description: z.string().max(2000).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour')
    .optional(),
  icon: z.string().max(50).optional(),
});

/** PATCH /api/workspaces/[id] */
export const WorkspaceUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex colour')
    .optional(),
  icon: z.string().max(50).optional(),
  is_archived: z.boolean().optional(),
});

/** POST /api/items/[id]/workspaces */
export const ItemWorkspaceBodySchema = z.object({
  workspace_id: z.string().uuid('workspace_id must be a valid UUID'),
  action: z.enum(['assign', 'unassign']),
});


// ──────────────────────────────────────────
// Admin User Management Schemas
// ──────────────────────────────────────────

const VALID_USER_ROLES = ['admin', 'editor', 'viewer'] as const;

/** POST /api/admin/users/invite */
export const UserInviteBodySchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'A valid email address is required')
    .email('A valid email address is required'),
  role: z.enum(VALID_USER_ROLES, {
    message: `Role must be one of: ${VALID_USER_ROLES.join(', ')}`,
  }),
  display_name: z.string().max(200).optional(),
});

/** PATCH /api/admin/users/[userId] */
export const UserRoleUpdateBodySchema = z.object({
  role: z.enum(VALID_USER_ROLES, {
    message: `Role must be one of: ${VALID_USER_ROLES.join(', ')}`,
  }),
});

// ──────────────────────────────────────────
// Priority Schema
// ──────────────────────────────────────────

const VALID_PRIORITIES = ['high', 'medium', 'low'] as const;

/** PATCH /api/items/[id]/priority */
export const PriorityUpdateBodySchema = z.object({
  priority: z.enum(VALID_PRIORITIES).nullable(),
});

// ──────────────────────────────────────────
// Template Analysis Schema
// ──────────────────────────────────────────

/** POST /api/bids/:id/templates/:templateId/analyse */
export const TemplateAnalyseBodySchema = z.object({
  force: z.boolean().default(false),
});

// ──────────────────────────────────────────
// OAuth Decision Schema
// ──────────────────────────────────────────

/** POST /api/oauth/decision */
export const OAuthDecisionBodySchema = z.object({
  decision: z.enum(['approve', 'deny']),
  authorization_id: z.string().min(1, 'Missing authorisation_id'),
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
  'content',
  'brief',
  'detail',
  'reference',
  'answer_standard',
  'answer_advanced',
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
  | 'user_tags'
  | 'content'
  | 'brief'
  | 'detail'
  | 'reference'
  | 'answer_standard'
  | 'answer_advanced';

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

/** POST /api/bids/:id/responses/draft-stream — single question, SSE */
export const ResponseDraftStreamBodySchema = z.object({
  question_id: z.string().uuid(),
  model_tier: z.enum(['analysis', 'drafting']).default('drafting'),
});

/** POST /api/bids/:id/responses/draft-all */
export const ResponseDraftAllBodySchema = z.object({
  model_tier: z.enum(['analysis', 'drafting']).default('drafting'),
  skip_existing: z.boolean().default(true),
});

/** POST /api/bids/:id/responses/estimate */
export const CostEstimateBodySchema = z.object({
  skip_existing: z.boolean().default(true),
});

/** PATCH /api/bids/:id/responses/:rId */
export const ResponseUpdateBodySchema = z.object({
  response_text: z.string().max(100000).optional(),
  response_text_advanced: z.string().max(100000).nullable().optional(),
  review_status: z.enum(['draft', 'ai_drafted', 'edited', 'approved', 'needs_review']).optional(),
  change_reason: z.string().max(500).optional(),
  source_content_ids: z.array(z.string().uuid()).max(100).optional(),
});

/** Zod schema for AI-extracted tender metadata (runtime validation) */
export const TenderExtractedMetadataSchema = z.object({
  buyer_name: z.string().nullable(),
  deadline: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .catch(null),
  reference_number: z.string().nullable(),
  estimated_value: z.string().nullable(),
  title: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

/** POST /api/bids/:id/responses/:rId/restore */
export const ResponseRestoreBodySchema = z.object({
  version: z.number().int().min(1),
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

/** Runtime validation for workspaces.domain_metadata when type='bid' */
export const BidMetadataSchema = z.object({
  buyer: z.string(),
  status: z.enum([
    'draft', 'questions_extracted', 'matching', 'drafting',
    'in_review', 'ready_for_export', 'submitted', 'won', 'lost', 'withdrawn',
  ]),
  deadline: z.string().datetime({ offset: true }).nullable(),
  reference_number: z.string().max(100).nullable(),
  estimated_value: z.string().max(100).nullable(),
  tender_source: z.enum(['upload', 'manual']).nullable(),
  tender_document_ids: z.array(z.string()),
  submission_date: z.string().datetime({ offset: true }).nullable(),
  outcome: z.enum(['won', 'lost', 'withdrawn']).nullable(),
  outcome_notes: z.string().max(5000).nullable(),
  notes: z.string().max(5000).nullable(),
  outcome_recorded_at: z.string().datetime({ offset: true }).optional(),
  outcome_recorded_by: z.string().uuid().optional(),
}).passthrough();

/** Parse and validate domain_metadata for bid workspaces */
export function parseBidMetadata(raw: unknown): z.infer<typeof BidMetadataSchema> | null {
  const result = BidMetadataSchema.safeParse(raw);
  if (!result.success) {
    console.warn('Invalid bid metadata:', result.error.format());
    return null;
  }
  return result.data;
}

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

// ──────────────────────────────────────────
// Tag Management Schemas (Session 53)
// ──────────────────────────────────────────

const VALID_TAG_TYPES = ['user', 'ai'] as const;

/**
 * Proper nouns, acronyms, and named standards that preserve their casing.
 * Mirrors the Python PROPER_NOUN_ALLOWLIST in classify.py.
 */
const TAG_PROPER_NOUN_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  ['iso 27001', 'ISO 27001'],
  ['iso 9001', 'ISO 9001'],
  ['iso 14001', 'ISO 14001'],
  ['iso 22301', 'ISO 22301'],
  ['gdpr', 'GDPR'],
  ['itil', 'ITIL'],
  ['prince2', 'PRINCE2'],
  ['cyber essentials', 'Cyber Essentials'],
  ['cyber essentials plus', 'Cyber Essentials Plus'],
  ['companies house', 'Companies House'],
  ['nhs', 'NHS'],
  ['ncsc', 'NCSC'],
  ['ico', 'ICO'],
  ['fca', 'FCA'],
  ['hmrc', 'HMRC'],
  ['pci dss', 'PCI DSS'],
  ['soc 2', 'SOC 2'],
  ['nist', 'NIST'],
  ['owasp', 'OWASP'],
]);

/**
 * Normalise a tag for consistent storage.
 * - Trims whitespace
 * - Preserves known proper nouns/acronyms
 * - Lowercases everything else
 * - Converts simple English plurals to singular (trailing 's')
 */
export function normaliseTag(tag: string): string {
  tag = tag.trim();
  if (!tag) return tag;

  // Check if it is a known proper noun (case-insensitive)
  const canonical = TAG_PROPER_NOUN_ALLOWLIST.get(tag.toLowerCase());
  if (canonical !== undefined) return canonical;

  // Lowercase
  tag = tag.toLowerCase();

  // Simple singular: strip trailing 's' unless word is short or matches
  // known patterns that should keep their trailing 's'
  if (
    tag.length > 3 &&
    tag.endsWith('s') &&
    !tag.endsWith('ss') &&
    !tag.endsWith('us') &&
    !tag.endsWith('sis') &&
    !tag.endsWith('ous')
  ) {
    tag = tag.slice(0, -1);
  }

  return tag;
}

/** DELETE /api/tags */
export const TagDeleteBodySchema = z.object({
  tag: z.string().trim().min(1, 'Tag is required').max(100),
  type: z.enum(VALID_TAG_TYPES),
});

/** POST /api/tags/rename */
export const TagRenameBodySchema = z.object({
  old: z.string().trim().min(1, 'Old tag name is required').max(100),
  new: z.string().trim().min(1, 'New tag name is required').max(100).transform(normaliseTag),
  type: z.enum(VALID_TAG_TYPES),
});

/** POST /api/tags/merge */
export const TagMergeBodySchema = z.object({
  source: z.string().trim().min(1, 'Source tag is required').max(100),
  target: z.string().trim().min(1, 'Target tag is required').max(100).transform(normaliseTag),
  type: z.enum(VALID_TAG_TYPES),
});

/** GET /api/tags/suggest?prefix=...&type=... */
export const TagSuggestParamsSchema = z.object({
  prefix: z.string().trim().min(1, 'Prefix is required').max(100),
  type: z.enum(VALID_TAG_TYPES),
});

/** GET /api/tags/duplicates?type=... */
export const TagDuplicatesParamsSchema = z.object({
  type: z.enum(VALID_TAG_TYPES),
});

/** GET /api/tags/by-domain?type=... */
export const TagByDomainParamsSchema = z.object({
  type: z.enum(VALID_TAG_TYPES),
});

/** GET /api/tags with filtering — query params */
export const TagFilteredParamsSchema = z.object({
  type: z.enum(VALID_TAG_TYPES).optional(),
  min_count: z.coerce.number().int().min(1).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** POST /api/tags/bulk-delete */
export const TagBulkDeleteBodySchema = z.object({
  tags: z.array(z.string().trim().min(1).max(100)).min(1, 'At least one tag is required').max(200),
  type: z.enum(VALID_TAG_TYPES),
});

/** POST /api/tags/bulk-merge */
export const TagBulkMergeBodySchema = z.object({
  sources: z.array(z.string().trim().min(1).max(100)).min(1, 'At least one source tag is required').max(200),
  target: z.string().trim().min(1, 'Target tag is required').max(100).transform(normaliseTag),
  type: z.enum(VALID_TAG_TYPES),
});

// ──────────────────────────────────────────
// Taxonomy Admin Schemas
// ──────────────────────────────────────────

/** POST /api/taxonomy/domains */
export const TaxonomyDomainCreateSchema = z.object({
  name: z.string().trim().min(1, 'Domain name is required').max(100),
  colour: z.string().trim().max(50).optional(),
  display_order: z.number().int().min(0).max(999).optional(),
});

/** PATCH /api/taxonomy/domains/:id */
export const TaxonomyDomainUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  colour: z.string().trim().max(50).nullable().optional(),
  display_order: z.number().int().min(0).max(999).optional(),
  is_active: z.boolean().optional(),
  accepted_at: z.string().datetime().nullable().optional(),
});

/** POST /api/taxonomy/subtopics */
export const TaxonomySubtopicCreateSchema = z.object({
  domain_id: z.string().uuid('domain_id must be a valid UUID'),
  name: z.string().trim().min(1, 'Subtopic name is required').max(100),
  display_order: z.number().int().min(0).max(999).optional(),
});

/** PATCH /api/taxonomy/subtopics/:id */
export const TaxonomySubtopicUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  display_order: z.number().int().min(0).max(999).optional(),
  is_active: z.boolean().optional(),
  accepted_at: z.string().datetime().nullable().optional(),
});

/** POST /api/taxonomy/reorder */
export const TaxonomyReorderSchema = z.object({
  type: z.enum(['domain', 'subtopic']),
  /** Required when type === 'subtopic'. Scopes reordering to a single domain. */
  domain_id: z.string().uuid().optional(),
  items: z.array(z.object({
    id: z.string().uuid(),
    display_order: z.number().int().min(0).max(999),
  })).min(1).max(100)
}).refine(
  (data) => data.type === 'domain' || !!data.domain_id,
  { message: 'domain_id is required when reordering subtopics', path: ['domain_id'] },
);

// ──────────────────────────────────────────
// Entity Management Schemas (Phase 4)
// ──────────────────────────────────────────

export const VALID_ENTITY_TYPES = [
  'organisation', 'certification', 'regulation', 'framework',
  'capability', 'person', 'technology', 'project', 'sector', 'product',
] as const;

/** GET /api/entities — query params */
export const EntityListParamsSchema = z.object({
  type: z.enum(VALID_ENTITY_TYPES).optional(),
  search: z.string().trim().max(200).optional(),
  variants_only: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  type_conflicts: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** POST /api/entities/merge */
export const EntityMergeBodySchema = z.object({
  sources: z.array(z.string().trim().min(1).max(500)).min(1, 'At least one source entity is required').max(50),
  target: z.string().trim().min(1, 'Target canonical name is required').max(500),
  entity_type: z.enum(VALID_ENTITY_TYPES),
});

/** POST /api/entities/split */
export const EntitySplitBodySchema = z.object({
  canonical_name: z.string().trim().min(1, 'Canonical name is required').max(500),
  variant_names: z.array(z.string().trim().min(1).max(500)).min(1, 'At least one variant is required').max(200),
  new_canonical_name: z.string().trim().min(1, 'New canonical name is required').max(500),
});

/** PATCH /api/entities/[canonical_name]/type */
export const EntityTypeOverrideBodySchema = z.object({
  entity_type: z.enum(VALID_ENTITY_TYPES),
});

// ──────────────────────────────────────────
// Content Metadata JSONB Schema (read-side)
// ──────────────────────────────────────────
//
// Runtime validation for content_items.metadata JSONB column.
// All keys are optional — metadata accumulates over time from
// different ingestion paths. Uses .passthrough() to allow
// unknown keys (metadata is extensible by design).
//
// Four functional categories:
//   1. Source provenance — where content came from
//   2. Content enrichment — derived/extracted content
//   3. User-facing state — drives UI behaviour and filtering
//   4. Import-specific context — particular to ingestion paths

/** Read-side schema for content_items.metadata JSONB */
export const ContentMetadataSchema = z.object({
  // ── 1. Source provenance ──────────────────
  /** File path of the ingested source (markdown pipeline, bid library) */
  source_file: z.string().optional(),
  /** Folder within the source directory (markdown pipeline) */
  source_folder: z.string().optional(),
  /** Pipeline identifier (e.g. 'markdown_pipeline', 'upload') */
  ingestion_source: z.string().optional(),
  /** Original format before conversion (e.g. 'markdown', 'docx') */
  original_format: z.string().optional(),
  /** Batch identifier grouping related imports (bid library) */
  import_batch: z.string().optional(),
  /** Original filename as uploaded by user */
  original_filename: z.string().optional(),
  /** File size in bytes */
  file_size: z.number().nonnegative().optional(),
  /** MIME type of the original file */
  mime_type: z.string().optional(),
  /** Batch tag applied during MCP or CLI import */
  batch_tag: z.string().optional(),
  /** Source document name (MCP create_content_item) */
  source_document: z.string().optional(),

  // ── 2. Content enrichment ─────────────────
  /** Reader-friendly HTML rendering */
  reader_html: z.string().optional(),
  /** Extracted images from the content item */
  extracted_images: z.array(z.record(z.string(), z.unknown())).optional(),
  /** Timestamp when images were extracted */
  images_extracted_at: z.string().optional(),
  /** Chapter/segment markers (video/podcast content) */
  chapters: z.array(z.record(z.string(), z.unknown())).optional(),
  /** Extracted tables from PDF/DOCX content */
  tables: z.array(z.record(z.string(), z.unknown())).optional(),
  /** Number of tables extracted */
  table_count: z.number().int().nonnegative().optional(),
  /** Number of pages in PDF/DOCX */
  page_count: z.number().int().nonnegative().optional(),

  // ── 3. User-facing state ──────────────────
  /** Content layer assignment (e.g. 'sales_brief', 'bid_detail') */
  layer: z.string().max(50).optional(),
  /** Topic group identifier for layer switcher navigation */
  topic_id: z.string().optional(),
  /** Whether the item is starred by the user */
  starred: z.boolean().optional(),

  // ── 4. Import-specific context ────────────
  /** Section name within the source document (bid library) */
  section_name: z.string().optional(),
  /** Table index within the source document (bid library) */
  table_index: z.number().int().nonnegative().optional(),
  /** Row index within a table (bid library) */
  row_index: z.number().int().nonnegative().optional(),
  /** Whether the item has a standard answer variant (bid library) */
  has_standard: z.boolean().optional(),
  /** Whether the item has an advanced answer variant (bid library) */
  has_advanced: z.boolean().optional(),
  /** Whether text extraction failed during upload */
  extraction_failed: z.boolean().optional(),
}).passthrough();

/** TypeScript type for content_items.metadata */
export type ContentMetadata = z.infer<typeof ContentMetadataSchema>;

/** Parse and validate content_items.metadata JSONB */
export function parseContentMetadata(raw: unknown): ContentMetadata | null {
  const result = ContentMetadataSchema.safeParse(raw);
  if (!result.success) {
    console.warn('Invalid content metadata:', result.error.format());
    return null;
  }
  return result.data;
}

// ──────────────────────────────────────────
// Layer vocabulary schemas
// ──────────────────────────────────────────

/** POST /api/layers — create a new layer */
export const LayerCreateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Key is required')
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, 'Key must be lowercase alphanumeric with underscores'),
  label: z.string().trim().min(1, 'Label is required').max(200),
  description: z.string().trim().max(500).optional(),
  display_order: z.number().int().min(0).optional(),
});

/** PATCH /api/layers/:id — update an existing layer */
export const LayerUpdateSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  display_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

/** PUT /api/layers/reorder — bulk update display_order */
export const LayerReorderSchema = z.object({
  layers: z
    .array(
      z.object({
        id: z.string().uuid('Invalid layer ID'),
        display_order: z.number().int().min(0),
      }),
    )
    .min(1, 'At least one layer must be provided'),
});
