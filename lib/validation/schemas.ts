import { z } from 'zod';
import pluralize from 'pluralize';
import { getValidTypeValues } from '@/lib/workspace-types';
import { logger } from '@/lib/logger/client';
import { validateWebUrl } from '@/lib/intelligence/url-validation';
import { CONTENT_TYPE_VALUES } from '@/lib/ontology/content-type-registry';

// ──────────────────────────────────────────
// Tag morphology — domain uncountable registration
// ──────────────────────────────────────────
// The `pluralize` library handles most English singular/plural morphology
// (including irregulars like children/child, knives/knife, heroes/hero,
// quizzes/quiz) but it strips the trailing 's' from several `-ics` fields
// of study that are treated as mass nouns in our domain. Register these
// as uncountable so direct library calls outside `toSingular` behave
// consistently. The TAG_PLURAL_LOOKING_SINGULARS override set is the
// primary protection — these registrations are defence-in-depth.
//
// Spec: docs/specs/p1-tag-morphology-library-adoption-spec.md §3.1.2
const DOMAIN_UNCOUNTABLES = [
  'economics',
  'ethics',
  'genetics',
  'linguistics',
  'logistics',
  'mathematics',
  'physics',
  'politics',
  'robotics',
  'statistics',
  'means',
] as const;

for (const word of DOMAIN_UNCOUNTABLES) {
  pluralize.addUncountableRule(word);
}

// ──────────────────────────────────────────
// Shared enums / constants
// ──────────────────────────────────────────

/**
 * Closed enumeration of valid `content_items.content_type` values.
 *
 * Re-exported from the markdown ontology register
 * (`docs/ontology/04-content-type.md` → `lib/ontology/content-type-registry.ts`).
 * The parity test (`__tests__/lib/ontology/markdown-parity.test.ts`) asserts
 * the markdown register and the live DB CHECK constraint remain in lockstep.
 *
 * Spec: `docs/specs/wp6-ontology-harness/TECH.md` §5.3.
 */
export const VALID_CONTENT_TYPES = CONTENT_TYPE_VALUES;

export const VALID_PLATFORMS = [
  'web',
  'email',
  'manual',
  'upload',
  'extraction',
  'other',
] as const;

/** @public */
export const VALID_SORT_FIELDS = [
  'captured_date',
  'classification_confidence',
  'primary_domain',
] as const;

/** @public */
export const VALID_SORT_ORDERS = ['asc', 'desc'] as const;

export const VALID_REVIEW_ACTIONS = [
  'verify',
  'flag',
  'skip',
  'unverify',
  'unflag',
] as const;

/** @public */
export const VALID_REVIEW_STATUSES = [
  'unverified',
  'verified',
  'flagged',
  'draft',
  'all',
] as const;

/** @public */
export const VALID_DIGEST_TYPES = ['weekly', 'daily', 'custom'] as const;

// ──────────────────────────────────────────
// API Route Schemas
// ──────────────────────────────────────────

/** POST /api/search */
export const SearchBodySchema = z.object({
  query: z.string().trim().min(1, 'Query is required').max(2000),
  threshold: z.number().min(0).max(1).default(0.35),
  limit: z
    .number()
    .int()
    .default(20)
    .transform((v) => Math.max(1, Math.min(100, v))),
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
  note: z.string().max(500).optional(),
});

/** GET /api/review/queue — validates status, limit, cursor only.
 *  Domain, content_type, and source_file are parsed separately via
 *  searchParams.getAll() in the route handler for proper array handling. */
/** @public */
export const VALID_REVIEW_QUEUE_SORTS = [
  'created_at',
  'confidence_asc',
  'quality_score_asc',
] as const;

export const ReviewQueueParamsSchema = z.object({
  status: z.enum(VALID_REVIEW_STATUSES).default('unverified'),
  limit: z
    .number()
    .int()
    .default(20)
    .transform((v) => Math.max(1, Math.min(100, v))),
  offset: z
    .number()
    .int()
    .default(0)
    .transform((v) => Math.max(0, v)),
  sort: z.enum(VALID_REVIEW_QUEUE_SORTS).default('created_at').optional(),
  /**
   * Optional opt-in widening: when the literal string 'true', the route
   * broadens the verified_at filter to OR-include
   * `governance_review_status = 'review_overdue'` rows. The route compares
   * the raw query-string value via `searchParams.get(...)==='true'`
   * (mirroring `assigned_to_me`) so explicit `?include_overdue=false`
   * resolves to off — `z.coerce.boolean()` cannot be used here because it
   * coerces every non-empty string (including the literal 'false') to
   * true. See S205 WP-E T2 plan §T2 (H-1).
   */
  include_overdue: z.string().optional(),
});

/**
 * GET /api/review/queue — publication-review branch params (tab 6 of /review).
 *
 * Validates limit + offset for the `?publication_status=in_review` branch
 * of the queue route. The publication-review tab is orthogonal to the
 * standard `status` axis (verified/unverified/flagged/draft/all) per
 * spec §6.7 line 1196 — it cannot reuse `ReviewQueueParamsSchema` directly
 * because that schema's `status` field defaults to 'unverified' and would
 * mislead the route.
 *
 * Domain / content_type / source_file / source_document_id are intentionally
 * NOT validated here — they mirror the standard branch which parses arrays
 * via `searchParams.getAll(...)` outside the schema for proper repeated-key
 * handling. The route layer applies the same filter shape via Supabase
 * query builder calls regardless of branch.
 *
 * V_W1 Finding 5 fix — replaces ad-hoc `Number(limitRaw) || 20` /
 * `Math.max/min` clamping at route.ts:482-487. Memory
 * `feedback_validation_sweep_safeparse_ban` requires schema-driven parsing
 * via `parseSearchParams` for routes reading typed query params.
 */
export const PublicationReviewQueueParamsSchema = z.object({
  publication_status: z.literal('in_review'),
  limit: z
    .number()
    .int()
    .default(20)
    .transform((v) => Math.max(1, Math.min(100, v))),
  offset: z
    .number()
    .int()
    .default(0)
    .transform((v) => Math.max(0, v)),
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
  limit: z
    .number()
    .int()
    .default(10)
    .transform((v) => Math.max(1, Math.min(50, v))),
  offset: z
    .number()
    .int()
    .default(0)
    .transform((v) => Math.max(0, v)),
});

/** GET /api/read-marks?item_ids=uuid1,uuid2,...
 *  item_ids is optional — when absent, the route returns counts-only.
 *  parseSearchParams returns a string for single comma-less values, so accept
 *  both single UUID and array shapes. */
export const ReadMarkCheckParamsSchema = z.object({
  item_ids: z
    .union([z.string().uuid(), z.array(z.string().uuid()).max(200)])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return Array.isArray(v) ? v : [v];
    }),
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
  content_type: z.enum(VALID_CONTENT_TYPES as readonly [string, ...string[]]),

  // Optional metadata
  primary_domain: z.string().max(200).optional(),
  primary_subtopic: z.string().trim().min(1).max(200).nullable().optional(),
  secondary_domain: z.string().max(200).optional(),
  secondary_subtopic: z.string().trim().min(1).max(200).nullable().optional(),
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
  // S202 §5.2 Phase 2.5 (T8b) — UI client (post-T8a rewire) submits
  // `publication_status: 'draft'` for save-as-draft. Without this field on
  // the schema, Zod would silently strip the property and the API would
  // create the item as published. Literal array mirrors
  // `VALID_PUBLICATION_STATUSES` in `lib/governance/publication-transitions.ts`
  // (drift pinned by `__tests__/lib/governance/publication-transitions.test.ts`).
  publication_status: z
    .enum(['draft', 'in_review', 'published', 'archived'])
    .optional(),

  // Ingestion source tracking
  ingestion_source: z
    .enum(['manual', 'upload', 'url_import', 'upload_autosplit'])
    .optional(),

  // Source document linkage (for batch creation and lineage tracking)
  source_document_id: z
    .string()
    .uuid('source_document_id must be a valid UUID')
    .optional(),

  // Admin-only dedup override (spec §6 D2). Non-admins passing this
  // flag are silently ignored — the dedup stamp proceeds as normal.
  skip_dedup: z.boolean().optional(),

  // S206 WP-A Phase 2 (AC3.3) — content owner override. Admin-only;
  // non-admins are silent-forced to the caller's userId via
  // `resolveContentOwnerId()` in @/lib/auth/owner-default. KBIntegrationBodySchema
  // is intentionally NOT widened (per H-4: route-side wiring only).
  content_owner_id: z.string().uuid().optional(),
});

/** POST /api/items/:id/classify -- on-demand classification */
export const ClassifyBodySchema = z.object({
  force: z.boolean().default(false),
});

/** PATCH /api/items/:id */
export const ItemUpdateBodySchema = z
  .object({
    field: z.enum([
      'suggested_title',
      'ai_keywords',
      'primary_domain',
      'primary_subtopic',
      'secondary_domain',
      'secondary_subtopic',
      'summary',
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
      'expiry_date',
      'lifecycle_type',
      // S200 WP5 §5.5 Phase 1 — review cadence governance fields. Both are
      // nullable in the DB and grouped with the lifecycle/governance cluster.
      // `next_review_date` is an ISO-8601 date string; `review_cadence_days`
      // is an integer in [1, 1095] mirroring the DB CHECK constraint.
      'next_review_date',
      'review_cadence_days',
      // S186 WP-B.5 — supersession. Admin-only; the route branches
      // before the generic update and calls setSupersession() instead.
      // Value is the NEW item's UUID (successor), or null to un-supersede.
      'superseded_by',
      // S202 §5.2 Phase 2 (T6) — publication lifecycle. Editor + admin per
      // §3.4 role-gate matrix; the route branches before the generic update
      // and consumes `lib/governance/publication-transitions.ts`.
      // Value is one of 'draft' | 'in_review' | 'published' | 'archived'.
      'publication_status',
    ]),
    value: z.union([
      z.string().max(500_000),
      z.array(z.string().max(100)),
      z.null(),
    ]),
    // Optional flags for content updates
    regenerate_embedding: z.boolean().optional(),
    reclassify: z.boolean().optional(),
    // S152B WP3 / Q-3: optional free-text "why did you make this change?"
    // captured from the admin edit UI and persisted to
    // `content_history.change_reason`. NULL when the user leaves the
    // field empty — the DB column is nullable. Canonical pipeline
    // values (`initial_ingest`, `reclassify`, etc.) are set by the
    // pipeline, not by this route.
    change_reason: z.string().max(500).optional().nullable(),
    // S202 §5.2 Phase 2 (T6) — optional human-readable reason stamped onto
    // `content_items.archive_reason` when transitioning `published →
    // archived`. Peer field (not part of the discriminated `value`) so it
    // can flow through alongside `field='publication_status'`. Other
    // transitions ignore the value (the helper at
    // `lib/governance/publication-transitions.ts` only stamps it on the
    // archive path).
    archive_reason: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
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
    const LONG_TEXT_FIELDS = [
      'content',
      'brief',
      'detail',
      'reference',
      'answer_standard',
      'answer_advanced',
    ];
    if (
      typeof data.value === 'string' &&
      !LONG_TEXT_FIELDS.includes(data.field)
    ) {
      if (data.value.length > 5_000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Value for field '${data.field}' must be at most 5,000 characters`,
          path: ['value'],
        });
      }
    }
    // superseded_by must be a UUID string, a valid stringified null, or null.
    if (data.field === 'superseded_by') {
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (data.value !== null && typeof data.value !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'superseded_by value must be a UUID string or null',
          path: ['value'],
        });
      } else if (typeof data.value === 'string' && !UUID_RE.test(data.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'superseded_by value must be a valid UUID',
          path: ['value'],
        });
      }
    }
    // S200 WP5 §5.5 Phase 1 — next_review_date must be NULL or an ISO-8601
    // date string (YYYY-MM-DD). The DB column is `date` so the time-of-day
    // portion is not relevant; we accept the calendar-date shape only.
    if (data.field === 'next_review_date') {
      if (data.value === null) {
        // OK — explicit clear.
      } else if (typeof data.value !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'next_review_date value must be an ISO-8601 date string or null',
          path: ['value'],
        });
      } else {
        const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
        const parsed = Date.parse(data.value);
        // Round-trip check defends against logically-invalid dates that JS
        // silently rolls over (e.g. '2026-02-30' → '2026-03-02'). The DB
        // would reject the rolled value; rejecting here gives the user a
        // clear Zod error instead of a delayed CHECK violation.
        const roundTripValid =
          ISO_DATE_RE.test(data.value) &&
          !Number.isNaN(parsed) &&
          new Date(parsed).toISOString().slice(0, 10) === data.value;
        if (!roundTripValid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'next_review_date value must be a valid ISO-8601 calendar date (YYYY-MM-DD)',
            path: ['value'],
          });
        }
      }
    }
    // S202 §5.2 Phase 2 (T6) — publication_status must be one of the four
    // CHECK-enforced values. Null is rejected — the column is NOT NULL post
    // S201/§5.2 Phase 1 (DEFAULT 'published'). Imported lazily as a literal
    // array (mirroring `VALID_PUBLICATION_STATUSES` from
    // `lib/governance/publication-transitions.ts`) so this schema file
    // remains free of cross-module imports — the runtime drift guard lives
    // in `__tests__/lib/governance/publication-transitions.test.ts`.
    if (data.field === 'publication_status') {
      if (data.value === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'publication_status cannot be null',
          path: ['value'],
        });
      } else if (
        typeof data.value !== 'string' ||
        !['draft', 'in_review', 'published', 'archived'].includes(data.value)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "publication_status must be one of 'draft', 'in_review', 'published', 'archived'",
          path: ['value'],
        });
      }
    }
    // S200 WP5 §5.5 Phase 1 — review_cadence_days must be NULL or an integer
    // between 1 and 1095 (inclusive), mirroring the DB CHECK constraint.
    // The schema's `value` union types this as string|string[]|null, so we
    // coerce a numeric string and verify integer + range.
    if (data.field === 'review_cadence_days') {
      if (data.value === null) {
        // OK — explicit clear.
      } else if (typeof data.value !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'review_cadence_days value must be an integer string or null',
          path: ['value'],
        });
      } else {
        const trimmed = data.value.trim();
        // Reject empty strings, non-integer shapes, leading zeros are OK
        // for parsing but only integer literals are accepted.
        const INT_RE = /^-?\d+$/;
        const n = INT_RE.test(trimmed) ? parseInt(trimmed, 10) : Number.NaN;
        if (Number.isNaN(n) || !Number.isInteger(n) || n < 1 || n > 1095) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'review_cadence_days value must be an integer between 1 and 1095',
            path: ['value'],
          });
        }
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
  type: z.enum(getValidTypeValues()).optional(),
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
  'summary',
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
  'expiry_date',
  'lifecycle_type',
  'governance_review_status',
  // S200 WP5 §5.5 Phase 1 — review cadence governance fields.
  'next_review_date',
  'review_cadence_days',
  // S202 §5.2 Phase 2 (T6) — publication lifecycle.
  'publication_status',
] as const);

/** @public */
export type EditableField =
  | 'suggested_title'
  | 'ai_keywords'
  | 'primary_domain'
  | 'primary_subtopic'
  | 'secondary_domain'
  | 'secondary_subtopic'
  | 'summary'
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
  | 'answer_advanced'
  | 'expiry_date'
  | 'lifecycle_type'
  | 'governance_review_status'
  // S200 WP5 §5.5 Phase 1 — review cadence governance fields.
  | 'next_review_date'
  | 'review_cadence_days'
  // S202 §5.2 Phase 2 (T6) — publication lifecycle.
  | 'publication_status';

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

/** POST /api/governance (create/update governance config via preset).
 *  `.strict()` rejects old-format bodies that include posture or other fields. */
export const GovernanceConfigBodySchema = z
  .object({
    domain: z.string().trim().min(1, 'Domain is required').max(200),
    preset: z.enum(['light_touch', 'strict']),
  })
  .strict();

/** POST /api/governance/review */
export const GovernanceReviewBodySchema = z.object({
  item_id: z.string().uuid('item_id must be a valid UUID'),
  action: z.enum(['approve', 'request_changes', 'revert']),
  notes: z.string().max(1000).optional(),
});

/** POST /api/review/assignments — create a review assignment */
export const ReviewAssignmentBodySchema = z.object({
  reviewer_id: z.string().uuid(),
  filter_domains: z.array(z.string()).default([]),
  filter_content_types: z.array(z.string()).default([]),
  filter_freshness: z.array(z.string()).default([]),
  filter_date_from: z.string().datetime().nullable().optional(),
  filter_date_to: z.string().datetime().nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

/** PATCH /api/review/assignments — update assignment status */
export const ReviewAssignmentUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['completed', 'cancelled']),
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
  status: z
    .enum([
      'draft',
      'questions_extracted',
      'matching',
      'drafting',
      'in_review',
      'ready_for_export',
      'submitted',
      'won',
      'lost',
      'withdrawn',
    ])
    .optional(),
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
  question_text: z
    .string()
    .trim()
    .min(1, 'Question text is required')
    .max(5000),
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
  review_status: z
    .enum(['draft', 'ai_drafted', 'edited', 'approved', 'needs_review'])
    .optional(),
  change_reason: z.string().max(500).optional(),
  source_content_ids: z.array(z.string().uuid()).max(100).optional(),
});

/** Zod schema for AI-extracted tender metadata (runtime validation) */
export const TenderExtractedMetadataSchema = z.object({
  buyer_name: z.string().nullable(),
  deadline: z.string().datetime({ offset: true }).nullable().catch(null),
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
  integrations: z.array(
    z.object({
      question_id: z.string().uuid(),
      action: z.enum(['new_entry', 'update_existing', 'skip']),
      target_content_id: z.string().uuid().nullable().optional(),
      title: z.string().max(500).optional(),
      content_type: z
        .enum(['q_a_pair', 'case_study', 'policy', 'methodology', 'capability'])
        .optional(),
    }),
  ),
  /**
   * Admin-only dedup override (spec §6 D2). When true and caller is
   * admin, skip the exact-hash pre-insert check and allow duplicates
   * through. Non-admins are silently ignored.
   */
  skip_dedup: z.boolean().optional(),
});

/**
 * Runtime validation for workspaces.domain_metadata when type='bid'
 * @public
 */
export const BidMetadataSchema = z
  .object({
    buyer: z.string(),
    status: z.enum([
      'draft',
      'questions_extracted',
      'matching',
      'drafting',
      'in_review',
      'ready_for_export',
      'submitted',
      'won',
      'lost',
      'withdrawn',
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
  })
  .passthrough();

/** Parse and validate domain_metadata for bid workspaces */
export function parseBidMetadata(
  raw: unknown,
): z.infer<typeof BidMetadataSchema> | null {
  const result = BidMetadataSchema.safeParse(raw);
  if (!result.success) {
    logger.warn({ err: result.error.format() }, 'Invalid bid metadata');
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
// Intelligence Schemas (Sector Intelligence)
// ──────────────────────────────────────────

/** POST /api/intelligence/profiles */
export const CompanyProfileCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase with hyphens only'),
  description: z.string().max(2000).optional(),
  website_url: z.string().url().optional().or(z.literal('')),
  sectors: z.array(z.string()).min(1, 'At least one sector is required'),
  services: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  geographic_scope: z.array(z.string()).default([]),
  competitors: z
    .array(
      z.object({
        name: z.string(),
        website: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  target_customers: z.string().max(1000).optional(),
  value_proposition: z.string().max(2000).optional(),
  key_topics: z.array(z.string()).min(1, 'At least one key topic is required'),
});

/** PATCH /api/intelligence/profiles/:id
 *
 * Explicit schema (not `.partial()`) because CompanyProfileCreateSchema's
 * `.default([])` values would silently overwrite stored rows on any PATCH
 * that omits services / certifications / geographic_scope / competitors.
 */
export const CompanyProfileUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200).optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase with hyphens only')
    .optional(),
  description: z.string().max(2000).optional(),
  website_url: z.string().url().optional().or(z.literal('')),
  sectors: z
    .array(z.string())
    .min(1, 'At least one sector is required')
    .optional(),
  services: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  geographic_scope: z.array(z.string()).optional(),
  competitors: z
    .array(
      z.object({
        name: z.string(),
        website: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
  target_customers: z.string().max(1000).optional(),
  value_proposition: z.string().max(2000).optional(),
  key_topics: z
    .array(z.string())
    .min(1, 'At least one key topic is required')
    .optional(),
});

// ──────────────────────────────────────────
// Organisation Profile (app-wide, P1-15)
// ──────────────────────────────────────────

/** PUT /api/organisation/profile — full upsert (not partial PATCH). */
export const OrganisationProfileUpsertSchema = z.object({
  name: z.string().min(1, 'Organisation name is required').max(200),
  description: z.string().max(2000).optional(),
  website_url: z.string().url().optional().or(z.literal('')),
  sectors: z.array(z.string()).min(1, 'At least one sector is required'),
  services: z.array(z.string()).default([]),
  certifications: z.array(z.string()).default([]),
  geographic_scope: z.array(z.string()).default([]),
  target_customers: z.string().max(1000).optional(),
  value_proposition: z.string().max(2000).optional(),
  key_topics: z.array(z.string()).default([]),
});

/** POST /api/intelligence/workspaces/:id/sources
 *
 * S222 W3-A §2.3.4 D-4: pre-insert `validateWebUrl` refinement on
 * `source_type='web'` rows. Async refinement — consumers MUST use
 * `parseBodyAsync` from `@/lib/validation` rather than the synchronous
 * `parseBody` helper. Zod throws `Encountered Promise during synchronous
 * parse` on `.parse()` for async schemas, so misuse is loud.
 */
export const FeedSourceCreateSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(200),
    url: z.string().url('Must be a valid URL'),
    source_type: z.enum(['rss', 'web', 'api']).default('rss'),
    polling_interval_minutes: z.number().int().min(5).max(1440).default(30),
    is_active: z.boolean().default(true),
  })
  .superRefine(async (data, ctx) => {
    // Web sources only — RSS uses `validateFeedUrl` at the route level;
    // API sources are non-goal for §2.3.4.
    if (data.source_type !== 'web') return;
    try {
      await validateWebUrl(data.url);
    } catch (err) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message:
          err instanceof Error
            ? err.message
            : 'Web URL validation failed (HEAD pre-flight rejected)',
      });
    }
  });

/** PATCH /api/intelligence/workspaces/:id/sources/:sourceId
 *
 * Explicit schema (not `.partial()`) because FeedSourceCreateSchema's
 * `.default()` values would silently overwrite stored rows on any PATCH
 * that omits source_type / polling_interval_minutes / is_active.
 */
export const FeedSourceUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200).optional(),
  url: z.string().url('Must be a valid URL').optional(),
  source_type: z.enum(['rss', 'web', 'api']).optional(),
  polling_interval_minutes: z.number().int().min(5).max(1440).optional(),
  is_active: z.boolean().optional(),
});

/** GET /api/intelligence/workspaces/:id/articles (query params) */
export const FeedArticleListParamsSchema = z.object({
  tab: z.enum(['passed', 'filtered']).default('passed'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  source_id: z.string().uuid().optional(),
});

/** POST /api/intelligence/workspaces/:id/articles/:articleId/flag */
export const FeedFlagCreateSchema = z.object({
  flag_type: z.enum(['false_positive', 'false_negative']),
  notes: z.string().max(1000).optional(),
});

/** POST /api/intelligence/workspaces/:id/prompts */
export const FeedPromptCreateSchema = z.object({
  prompt_text: z
    .string()
    .min(10, 'Prompt must be at least 10 characters')
    .max(10000),
  change_notes: z.string().max(1000).optional(),
});

/** POST /api/intelligence/workspaces */
export const IntelligenceWorkspaceCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(2000).optional(),
  company_profile_id: z.string().uuid('Must select a company profile'),
});

/** PATCH /api/intelligence/workspaces/:id */
export const IntelligenceWorkspaceUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200).optional(),
  description: z.string().max(2000).optional(),
  /**
   * SI-L5: Workspace-level relevance threshold for article scoring.
   * Pre-T2 (S245): stored in `workspaces.domain_metadata.relevance_threshold` JSONB.
   * Post-T2 (S246): stored on `intelligence_workspaces.relevance_threshold` typed column.
   * Read path: `getIntelligenceWorkspaceContext()` in `@/lib/intelligence/workspace-context`.
   * Pipeline behaviour gate: `lib/intelligence/pipeline.ts` (DEFAULT_RELEVANCE_THRESHOLD = 0.5).
   * Admin-only — checked in the route handler.
   */
  relevance_threshold: z.number().min(0.1).max(1.0).optional(),
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
  ['duns', 'DUNS'],
]);

/**
 * Words that visually end in 's' but are not plurals — must NOT be
 * singularised. Extend with care; each entry here is a permanent carve-out.
 */
const TAG_PLURAL_LOOKING_SINGULARS: ReadonlySet<string> = new Set([
  'news',
  'means',
  'series',
  'species',
  // -ics fields of study: singular in domain usage (not plural of -ic)
  'analytics',
  'economics',
  'ethics',
  'genetics',
  'linguistics',
  'logistics',
  'mathematics',
  'physics',
  'politics',
  'robotics',
  'statistics',
  // Latin/Greek singulars that the morphology library would otherwise
  // mis-singularise (data→datum, basis→basi, axis→axi, oasis→oasi).
  // Keeps TS↔Python parity. Surfaced by the §1.17 corpus eval; preserved
  // here to avoid regressing existing tags.
  'data',
  'basis',
  'axis',
  'oasis',
]);

/**
 * Convert an English plural word to its singular form.
 *
 * Layered guards (in order):
 *   1. Short-word guard (len <= 3): 'bus', 'gas' etc. kept as-is (fast path
 *      + matches Python behaviour).
 *   2. Whole-input override: TAG_PLURAL_LOOKING_SINGULARS exact match.
 *   3. Last-token override: for compound tags ('inspection data',
 *      'school data'), the override layer protects the final whitespace-
 *      delimited token. pluralize.singular operates on the last token
 *      regardless of trailing characters, so without this layer the
 *      `data` → `datum` conversion would surface in compounds even
 *      though `data` alone is preserved.
 *   4. Library fallback: pluralize.singular() handles regular + irregular
 *      English morphology including -ies → -y, -ves → -f, -oes → -o,
 *      quizzes → quiz, children → child, mice → mouse, etc.
 *
 * Spec: docs/specs/p1-tag-morphology-library-adoption-spec.md §3.1.2
 *
 * Historical note: prior to S197 this function used hand-rolled suffix
 * rules that could not handle irregular forms. The pluralize library ships
 * with 500+ rules including all of those. Domain uncountables that
 * pluralize does not know about (10 `-ics` fields + 'means') are
 * registered at module load above.
 */
function toSingular(tag: string): string {
  if (tag.length <= 3) return tag;
  if (TAG_PLURAL_LOOKING_SINGULARS.has(tag)) return tag;

  // For compound tags, protect the final token if it is in the override
  // set. pluralize would otherwise apply morphology to the last token
  // (e.g. 'inspection data' → 'inspection datum'). Splitting on a single
  // ASCII space keeps parity with the Python re.ASCII whitespace path.
  const spaceIdx = tag.lastIndexOf(' ');
  if (spaceIdx > 0) {
    const lastToken = tag.slice(spaceIdx + 1);
    if (TAG_PLURAL_LOOKING_SINGULARS.has(lastToken)) {
      return tag;
    }
  }

  return pluralize.singular(tag);
}

/**
 * Normalise a tag for consistent storage.
 * - Trims leading/trailing whitespace
 * - Collapses internal whitespace to single space (ASCII whitespace only)
 * - Preserves known proper nouns/acronyms
 * - Lowercases everything else
 * - Converts simple English plurals to singular (see toSingular)
 *
 * The whitespace regex uses an explicit ASCII character class [\t\n\r\f\v ]+
 * (NOT \s+) to maintain parity with the Python normalise_keyword() which uses
 * re.ASCII. Unicode whitespace (e.g. U+00A0 NBSP) is intentionally NOT matched.
 */
export function normaliseTag(tag: string): string {
  tag = tag.trim();
  if (!tag) return tag;

  // Collapse internal whitespace (ASCII-only parity with Python)
  tag = tag.replace(/[\t\n\r\f\v ]+/g, ' ');

  // Check if it is a known proper noun (case-insensitive)
  const canonical = TAG_PROPER_NOUN_ALLOWLIST.get(tag.toLowerCase());
  if (canonical !== undefined) return canonical;

  // Lowercase + singularise
  tag = tag.toLowerCase();
  tag = toSingular(tag);

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
  new: z
    .string()
    .trim()
    .min(1, 'New tag name is required')
    .max(100)
    .transform(normaliseTag),
  type: z.enum(VALID_TAG_TYPES),
});

/** POST /api/tags/merge */
export const TagMergeBodySchema = z.object({
  source: z.string().trim().min(1, 'Source tag is required').max(100),
  target: z
    .string()
    .trim()
    .min(1, 'Target tag is required')
    .max(100)
    .transform(normaliseTag),
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
  limit: z.coerce
    .number()
    .int()
    .optional()
    .transform((v) => (v != null ? Math.max(1, Math.min(500, v)) : v)),
  offset: z.coerce
    .number()
    .int()
    .optional()
    .transform((v) => (v != null ? Math.max(0, v) : v)),
});

/** POST /api/tags/bulk-delete */
export const TagBulkDeleteBodySchema = z.object({
  tags: z
    .array(z.string().trim().min(1).max(100))
    .min(1, 'At least one tag is required')
    .max(200),
  type: z.enum(VALID_TAG_TYPES),
});

/** POST /api/tags/bulk-merge */
export const TagBulkMergeBodySchema = z.object({
  sources: z
    .array(z.string().trim().min(1).max(100))
    .min(1, 'At least one source tag is required')
    .max(200),
  target: z
    .string()
    .trim()
    .min(1, 'Target tag is required')
    .max(100)
    .transform(normaliseTag),
  type: z.enum(VALID_TAG_TYPES),
});

// ──────────────────────────────────────────
// Tag morphology drift flags (§1.17 / S197 WP3)
// ──────────────────────────────────────────

/** @public */
export const TAG_MORPHOLOGY_DECISION_VALUES = [
  'pending',
  'accept',
  'add_override',
  'dismiss',
] as const;

/** GET /api/admin/tag-morphology/flags?decision=pending&limit=...&offset=... */
export const TagMorphologyFlagsQuerySchema = z.object({
  decision: z.enum(TAG_MORPHOLOGY_DECISION_VALUES).optional(),
  limit: z.coerce
    .number()
    .int()
    .optional()
    .transform((v) => (v != null ? Math.max(1, Math.min(500, v)) : v)),
  offset: z.coerce
    .number()
    .int()
    .optional()
    .transform((v) => (v != null ? Math.max(0, v) : v)),
});

/** POST /api/admin/tag-morphology/flags — bulk insert from dry-run eval output */
export const TagMorphologyFlagsBulkInsertSchema = z.object({
  flags: z
    .array(
      z.object({
        stored_tag: z.string().trim().min(1).max(200),
        proposed_canonical: z.string().trim().min(1).max(200),
        usage_count: z.number().int().min(0),
        affected_content_ids: z.array(z.string().uuid()).max(10000),
      }),
    )
    .min(1, 'At least one flag is required')
    .max(2000),
});

/** PATCH /api/admin/tag-morphology/flags/[id] — disposition a flag */
export const TagMorphologyFlagDecisionSchema = z.object({
  decision: z.enum(['accept', 'add_override', 'dismiss']),
  decision_rationale: z.string().trim().max(2000).optional(),
});

// ──────────────────────────────────────────
// Taxonomy Admin Schemas
// ──────────────────────────────────────────

/** POST /api/taxonomy/domains */
export const TaxonomyDomainCreateSchema = z.object({
  name: z.string().trim().min(1, 'Domain name is required').max(100),
  colour: z.string().trim().max(50).optional(),
  display_order: z.number().int().min(0).max(999).optional(),
  key_signal: z.string().trim().max(1000).optional(),
});

/** PATCH /api/taxonomy/domains/:id */
export const TaxonomyDomainUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  colour: z.string().trim().max(50).nullable().optional(),
  display_order: z.number().int().min(0).max(999).optional(),
  is_active: z.boolean().optional(),
  accepted_at: z.string().datetime().nullable().optional(),
  key_signal: z.string().trim().max(1000).nullable().optional(),
});

/** POST /api/taxonomy/subtopics */
export const TaxonomySubtopicCreateSchema = z.object({
  domain_id: z.string().uuid('domain_id must be a valid UUID'),
  name: z.string().trim().min(1, 'Subtopic name is required').max(100),
  display_order: z.number().int().min(0).max(999).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

/** PATCH /api/taxonomy/subtopics/:id */
export const TaxonomySubtopicUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  display_order: z.number().int().min(0).max(999).optional(),
  is_active: z.boolean().optional(),
  accepted_at: z.string().datetime().nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

/** POST /api/taxonomy/reorder */
export const TaxonomyReorderSchema = z
  .object({
    type: z.enum(['domain', 'subtopic']),
    /** Required when type === 'subtopic'. Scopes reordering to a single domain. */
    domain_id: z.string().uuid().optional(),
    items: z
      .array(
        z.object({
          id: z.string().uuid(),
          display_order: z.number().int().min(0).max(999),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine((data) => data.type === 'domain' || !!data.domain_id, {
    message: 'domain_id is required when reordering subtopics',
    path: ['domain_id'],
  });

// ──────────────────────────────────────────
// Entity Management Schemas (Phase 4)
// ──────────────────────────────────────────

export const VALID_ENTITY_TYPES = [
  'organisation',
  'certification',
  'regulation',
  'framework',
  'capability',
  'person',
  'technology',
  'project',
  'sector',
  'product',
  'standard',
  'methodology',
] as const;

/** GET /api/entities — query params */
export const EntityListParamsSchema = z.object({
  type: z.enum(VALID_ENTITY_TYPES).optional(),
  search: z.string().trim().max(200).optional(),
  variants_only: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .optional(),
  type_conflicts: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .default(100)
    .transform((v) => Math.max(1, Math.min(500, v))),
  offset: z.coerce
    .number()
    .int()
    .default(0)
    .transform((v) => Math.max(0, v)),
});

/** POST /api/entities/merge */
export const EntityMergeBodySchema = z.object({
  sources: z
    .array(z.string().trim().min(1).max(500))
    .min(1, 'At least one source entity is required')
    .max(50),
  target: z
    .string()
    .trim()
    .min(1, 'Target canonical name is required')
    .max(500),
  entity_type: z.enum(VALID_ENTITY_TYPES),
});

/** POST /api/entities/split */
export const EntitySplitBodySchema = z.object({
  canonical_name: z
    .string()
    .trim()
    .min(1, 'Canonical name is required')
    .max(500),
  variant_names: z
    .array(z.string().trim().min(1).max(500))
    .min(1, 'At least one variant is required')
    .max(200),
  new_canonical_name: z
    .string()
    .trim()
    .min(1, 'New canonical name is required')
    .max(500),
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
export const ContentMetadataSchema = z
  .object({
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
    // Note: `layer` and `starred` were promoted to proper columns on
    // content_items in S117 and are no longer stored in metadata JSONB.
    /** Topic group identifier for layer switcher navigation */
    topic_id: z.string().optional(),

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
  })
  .passthrough();

/** TypeScript type for content_items.metadata */
export type ContentMetadata = z.infer<typeof ContentMetadataSchema>;

/** Parse and validate content_items.metadata JSONB */
export function parseContentMetadata(raw: unknown): ContentMetadata | null {
  const result = ContentMetadataSchema.safeParse(raw);
  if (!result.success) {
    logger.warn({ err: result.error.format() }, 'Invalid content metadata');
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
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Key must be lowercase alphanumeric with underscores',
    ),
  label: z.string().trim().min(1, 'Label is required').max(200),
  description: z.string().trim().max(500).optional(),
  display_order: z.number().int().min(0).optional(),
});

/** PATCH /api/layers/:id — update an existing layer */
export const LayerUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    display_order: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
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

// ──────────────────────────────────────────
// Content Owner Assignment Schemas
// ──────────────────────────────────────────

/** PATCH /api/items/[id]/owner — assign or unassign a content owner */
export const OwnerAssignSchema = z.object({
  owner_id: z.string().uuid('owner_id must be a valid UUID').nullable(),
});

/** POST /api/content-owners/bulk-assign — bulk assign content owner */
export const BulkOwnerAssignSchema = z
  .object({
    item_ids: z.array(z.string().uuid()).min(1).max(500).optional(),
    filter: z
      .object({
        domain: z.string().optional(),
        subtopic: z.string().optional(),
        content_type: z.string().optional(),
        unowned_only: z.boolean().default(true),
      })
      .optional(),
    owner_id: z.string().uuid('owner_id must be a valid UUID'),
  })
  .refine((data) => data.item_ids || data.filter, {
    message: 'Either item_ids or filter must be provided',
  });

// ──────────────────────────────────────────
// Shared Query Parameter Building Blocks
// ──────────────────────────────────────────

/** Reusable pagination params: limit + offset */
export const PaginationParamsSchema = z.object({
  limit: z
    .number()
    .int()
    .default(20)
    .transform((v) => Math.max(1, Math.min(100, v))),
  offset: z
    .number()
    .int()
    .default(0)
    .transform((v) => Math.max(0, v)),
});

/** Pagination with a configurable default limit (for routes that default to 50) */
export function paginationParams(defaults?: {
  limit?: number;
  maxLimit?: number;
}) {
  const defaultLimit = defaults?.limit ?? 20;
  const maxLimit = defaults?.maxLimit ?? 100;
  return z.object({
    limit: z
      .number()
      .int()
      .default(defaultLimit)
      .transform((v) => Math.min(Math.max(v, 1), maxLimit)),
    offset: z
      .number()
      .int()
      .default(0)
      .transform((v) => Math.max(0, v)),
  });
}

/** Boolean flag from query string ('true'/'false' -> boolean) */
export const booleanParam = z.preprocess(
  (v) => v === 'true' || v === true,
  z.boolean(),
);

// ──────────────────────────────────────────
// Moved from route files (centralisation)
// ──────────────────────────────────────────

/** PATCH /api/quality — resolve a quality flag */
export const QualityResolveBodySchema = z.object({
  flag_id: z.string().uuid('flag_id must be a valid UUID'),
  resolution_notes: z.string().max(1000).optional(),
});

/** POST /api/oauth/revoke */
export const RevokeSchema = z.object({
  clientId: z.string().uuid('Invalid client ID'),
});

/** PUT /api/coverage/targets — upsert coverage targets */
const coverageTargetEntrySchema = z.object({
  domain_id: z.string().uuid(),
  metric_name: z.enum(['item_count', 'fresh_pct', 'max_expired']),
  target_value: z.number().min(0),
});

export const CoverageTargetPutBodySchema = z.object({
  targets: z.array(coverageTargetEntrySchema).min(1).max(200),
});

/**
 * Build a metadata update schema with DB-driven layer keys.
 *
 * PATCH /api/items/[id]/metadata — update metadata (layer, topic_id).
 * The `layer` field is constrained to the provided `layerKeys` list
 * (fetched from `layer_vocabulary` at request time via `fetchActiveLayerKeys`).
 */
export function buildItemMetadataUpdateSchema(layerKeys: string[]) {
  return z
    .object({
      layer: z
        .enum(layerKeys as [string, ...string[]])
        .nullable()
        .optional(),
      topic_id: z.string().max(200).nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one metadata field required',
    });
}

// ──────────────────────────────────────────
// Category B: GET handler schemas
// ──────────────────────────────────────────

/** GET /api/activity */
export const ActivityParamsSchema = z.object({
  limit: z
    .number()
    .int()
    .default(20)
    .transform((v) => Math.min(Math.max(v, 1), 100)),
  before: z.string().optional(), // ISO timestamp cursor
});

/** GET /api/quality (flags list) */
export const QualityFlagsParamsSchema = z.object({
  item_id: z.string().uuid().optional(),
  flag_type: z.string().max(50).optional(),
  resolved: z.preprocess(
    (v) => (v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional(),
  ),
  limit: z
    .number()
    .int()
    .default(50)
    .transform((v) => Math.max(1, Math.min(200, v))),
  offset: z
    .number()
    .int()
    .default(0)
    .transform((v) => Math.max(0, v)),
});

/** GET /api/pipeline-runs */
export const PipelineRunsParamsSchema = z.object({
  limit: z
    .number()
    .int()
    .default(20)
    .transform((v) => Math.min(Math.max(v, 1), 100)),
  pipeline_name: z.string().max(100).optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']).optional(),
  all: booleanParam.optional(),
});

/** GET /api/insights
 * Note: keyword is conditionally required when type=topic,
 * author is conditionally required when type=author.
 * These cross-field constraints are enforced in the route handler's
 * switch-case, not in this schema. See B4 special case notes.
 */
const VALID_INSIGHT_TYPES = [
  'trends',
  'topic',
  'author',
  'gaps',
  'reading',
] as const;

export const InsightsParamsSchema = z.object({
  type: z.enum(VALID_INSIGHT_TYPES).default('trends'),
  days: z.number().int().min(1).max(365).default(30),
  min_count: z.number().int().min(1).max(100).default(2),
  keyword: z.string().max(200).optional(),
  author: z.string().max(200).optional(),
});

/** GET /api/bids */
const VALID_BID_STATUSES = [
  'draft',
  'questions_extracted',
  'matching',
  'drafting',
  'in_review',
  'ready_for_export',
  'submitted',
  'won',
  'lost',
  'withdrawn',
] as const;

export const BidListParamsSchema = z.object({
  status: z.enum(VALID_BID_STATUSES).optional(),
  limit: z
    .number()
    .int()
    .default(50)
    .transform((v) => Math.max(1, Math.min(100, v))),
  offset: z
    .number()
    .int()
    .default(0)
    .transform((v) => Math.max(0, v)),
});

/** GET /api/governance/review */
export const GovernanceReviewParamsSchema = z.object({
  count_only: booleanParam.optional(),
  limit: z
    .number()
    .int()
    .default(20)
    .transform((v) => Math.max(1, Math.min(100, v))),
  offset: z
    .number()
    .int()
    .default(0)
    .transform((v) => Math.max(0, v)),
});

/** GET /api/coverage/gaps */
const VALID_GAP_SOURCES = ['taxonomy', 'template', 'guide'] as const;
const VALID_PRIORITY_TIERS = ['critical', 'high', 'medium', 'low'] as const;

export const CoverageGapsParamsSchema = z.object({
  source: z.enum(VALID_GAP_SOURCES).optional(),
  priority: z.enum(VALID_PRIORITY_TIERS).optional(),
  domain: z.string().max(200).optional(),
  limit: z
    .number()
    .int()
    .default(25)
    .transform((v) => Math.min(Math.max(v, 1), 100)),
  offset: z
    .number()
    .int()
    .default(0)
    .transform((v) => Math.max(0, v)),
});

/** GET /api/content-suggestions */
export const ContentSuggestionsParamsSchema = z.object({
  limit: z
    .number()
    .int()
    .default(5)
    .transform((v) => Math.min(Math.max(v, 1), 20)),
  domain: z.string().max(200).optional(),
});

/** GET /api/guides */
const VALID_GUIDE_TYPES = [
  'sector',
  'product',
  'company',
  'research',
  'custom',
] as const;

export const GuideListParamsSchema = z.object({
  type: z.enum(VALID_GUIDE_TYPES).optional(),
  include_unpublished: booleanParam.optional(),
  include: z.enum(['stats']).optional(),
});

/** GET /api/workspaces/[id]/items */
export const WorkspaceItemsParamsSchema = z.object({
  limit: z
    .number()
    .int()
    .default(10)
    .transform((v) => Math.max(1, Math.min(50, v))),
});

/** GET /api/workspaces */
export const WorkspaceListParamsSchema = z.object({
  include_archived: booleanParam.optional(),
});

/** GET /api/coverage */
export const CoverageMatrixParamsSchema = z.object({
  layer: z.string().max(100).optional(),
});

/** GET /api/coverage/templates */
export const CoverageTemplateParamsSchema = z.object({
  template_name: z.string().min(1, 'template_name is required').max(200),
  template_version: z.string().max(50).optional(),
});

/** GET /api/review/history */
export const ReviewHistoryParamsSchema = z.object({
  item_id: z.string().uuid('item_id must be a valid UUID'),
});

/** GET /api/review/assignments */
export const ReviewAssignmentsParamsSchema = z.object({
  status: z.enum(['active', 'completed', 'cancelled', 'all']).default('active'),
});

/** GET /api/entities/co-occurrence */
export const EntityCoOccurrenceParamsSchema = z.object({
  limit: z
    .number()
    .int()
    .default(20)
    .transform((v) => Math.max(1, Math.min(50, v))),
  min: z.number().int().min(1).default(2),
  type: z
    .enum([
      'organisation',
      'certification',
      'regulation',
      'framework',
      'capability',
      'person',
      'technology',
      'project',
      'sector',
      'product',
    ])
    .optional(),
});

/** DELETE /api/workspaces/[id] — query param for permanent delete */
export const WorkspaceDeleteParamsSchema = z.object({
  permanent: booleanParam.optional(),
});

/** GET /api/bids/[id]/tender/download */
export const TenderDownloadParamsSchema = z.object({
  path: z.string().min(1, 'Storage path is required').max(500),
});

// ──────────────────────────────────────────
// Category C: Missing body schemas
// ──────────────────────────────────────────

/** POST /api/users/display-names */
export const DisplayNamesBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID required').max(50),
});

/** GET /api/admin/provenance/pipeline-runs */
export const AdminProvenancePipelineRunsParamsSchema = z.object({
  range: z.enum(['1h', '24h', '7d', '30d']).default('24h'),
  // parseSearchParams pre-splits comma-separated values into arrays,
  // so accept both string and string[] to be robust.
  kinds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const arr = Array.isArray(v) ? v : v.split(',');
      return arr.filter(Boolean).slice(0, 20);
    }),
  limit: z.coerce
    .number()
    .int()
    .default(50)
    .transform((v) => Math.min(Math.max(v, 1), 200)),
  cursor_started_at: z.string().datetime().optional(),
  cursor_id: z.string().uuid().optional(),
});

/** PATCH /api/entities/[canonical_name]/metadata */
export const EntityMetadataUpdateSchema = z
  .record(z.string(), z.unknown())
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one metadata field required',
  });

/** POST /api/items/[id]/archive */
export const ArchiveBodySchema = z.object({
  reason: z.string().trim().min(1, 'Reason is required').max(1000),
});

// ──────────────────────────────────────────
// §1.7 Admin Cross-System Dedup Review (S211B)
// ──────────────────────────────────────────

/** GET /api/admin/content-dedup/queue — list filters + cursor pagination */
export const DedupQueueQuerySchema = z.object({
  domain: z.string().optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  sort: z
    .enum(['created_at_desc', 'similarity_desc'])
    .optional()
    .default('created_at_desc'),
});

/** POST /api/admin/content-dedup/[id]/{confirm-duplicate,confirm-unique} */
export const DedupActionBodySchema = z.object({
  note: z.string().max(500).optional(),
});

/** POST /api/admin/content-dedup/[id]/supersede */
export const DedupSupersedeBodySchema = z.object({
  canonicalId: z.string().uuid(),
  direction: z
    .enum(['canonical-supersedes-subject', 'subject-supersedes-canonical'])
    .default('canonical-supersedes-subject'),
  note: z.string().max(500).optional(),
});

// ──────────────────────────────────────────
// §1.9 Near-Duplicate Merge Dashboard (S212B)
// Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.2
// ──────────────────────────────────────────

/** GET /api/admin/content-dedup/near-duplicates — list filters */
export const NearDupPairsQuerySchema = z.object({
  threshold: z.coerce.number().min(0.85).max(0.99).optional().default(0.95),
  domain: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

/**
 * POST /api/admin/content-dedup/near-duplicates/[pairId]/confirm-unique
 *
 * `similarity_at_resolution` + `threshold_at_resolution` carry OQ2 audit
 * context (similarity score the admin saw + filter threshold that
 * surfaced the pair). Optional — the route forwards `null` when omitted.
 */
export const NearDupConfirmUniqueBodySchema = z.object({
  note: z.string().max(500).optional(),
  similarity_at_resolution: z.number().min(0).max(1).optional(),
  threshold_at_resolution: z.number().min(0.85).max(0.99).optional(),
});

/**
 * POST /api/admin/content-dedup/near-duplicates/[pairId]/merge
 *
 * `similarity_at_resolution` + `threshold_at_resolution` carry OQ2 audit
 * context, mirroring the confirm-unique payload so the merge audit row
 * records the same context. Optional.
 */
export const NearDupMergeBodySchema = z
  .object({
    oldId: z.string().uuid(),
    newId: z.string().uuid(),
    note: z.string().max(500).optional(),
    similarity_at_resolution: z.number().min(0).max(1).optional(),
    threshold_at_resolution: z.number().min(0.85).max(0.99).optional(),
  })
  .refine((b) => b.oldId !== b.newId, {
    message: 'oldId and newId must differ',
    path: ['newId'],
  });

/** POST /api/items/[id]/vision */
export const VisionBodySchema = z.object({
  prompt: z.string().max(5000).optional(),
});

/** POST /api/source-documents/[id]/send-to-review */
export const SendToReviewBodySchema = z.object({
  item_ids: z
    .array(z.string().uuid())
    .min(1, 'At least one item ID required')
    .max(200),
});

/** POST /api/source-documents/[id]/diff — compute diff */
export const DiffRequestBodySchema = z.object({
  new_document_id: z
    .string()
    .uuid('new_document_id is required and must be a valid UUID'),
});

/** PATCH /api/source-documents/[id]/diff — review status updates */
const VALID_DIFF_REVIEW_STATUSES = [
  'applied',
  'dismissed',
  'pending_review',
] as const;

export const DiffReviewUpdateBodySchema = z.object({
  entries: z
    .array(
      z.object({
        id: z.string().uuid(),
        status: z.enum(VALID_DIFF_REVIEW_STATUSES),
        note: z.string().max(500).optional(),
      }),
    )
    .min(1, 'entries must be a non-empty array')
    .max(500),
});

// ──────────────────────────────────────────
// Verification History Export
// ──────────────────────────────────────────

/** GET /api/admin/provenance/export/verification-history */
export const VerificationHistoryExportParamsSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine(
    (d) => {
      if (d.from && d.to) return new Date(d.from) <= new Date(d.to);
      return true;
    },
    { message: 'from must be before or equal to to' },
  )
  .refine(
    (d) => {
      if (d.from && d.to) {
        const diffDays =
          (new Date(d.to).getTime() - new Date(d.from).getTime()) / 86400000;
        return diffDays <= 365;
      }
      return true;
    },
    { message: 'Maximum export window is 365 days' },
  );

// ──────────────────────────────────────────
// Notification Preferences
// ──────────────────────────────────────────

/**
 * PUT body for /api/notifications/preferences.
 *
 * At least one field must be provided. All fields are optional booleans
 * (partial update). Unknown fields are rejected via `.strict()`.
 */
export const NotificationPreferencesPutBodySchema = z
  .object({
    email_weekly_change_report: z.boolean().optional(),
    email_review_assigned: z.boolean().optional(),
    email_owned_content_flagged: z.boolean().optional(),
    auto_generate_change_reports: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one preference field is required',
  });

// ──────────────────────────────────────────
// Publication bulk-action (§5.3 publication approval gate)
// ──────────────────────────────────────────

/**
 * POST body for `/api/review/publication-bulk-action`.
 *
 * Bulk-approve / bulk-return-to-draft for items currently in publication
 * status `'in_review'`. Spec: .planning/.archive/.specs/publication-approval-gate-spec.md (archived S220 W4)
 * §4.2. Cap of 50 items per request ratified S217 close-out (D-3) — halves
 * the 30s Vercel function-timeout exposure under DB-load spikes vs the
 * authored 100-default.
 *
 * `action` literals map to per-item target states inside the route handler:
 * - `'approve'` → `'published'`
 * - `'return_to_draft'` → `'draft'`
 *
 * These are the only two transitions valid out of `'in_review'` per
 * `lib/governance/publication-transitions.ts:75-80` (RBAC matrix).
 */
export const PublicationBulkActionBodySchema = z.object({
  ids: z
    .array(z.string().uuid('ids must be UUIDs'))
    .min(1, 'At least one id is required')
    .max(50, 'At most 50 items per request'),
  action: z.enum(['approve', 'return_to_draft']),
});

export type PublicationBulkActionBody = z.infer<
  typeof PublicationBulkActionBodySchema
>;
