import { z } from 'zod';
import pluralize from 'pluralize';
import { getValidTypeValues } from '@/lib/workspace-types';
import { logger } from '@/lib/logger/client';
import { validateWebUrl } from '@/lib/intelligence/url-validation';
import { CONTENT_TYPE_VALUES } from '@/lib/ontology/content-type-registry';
import { BRANDING } from '@/lib/client-config';
import { PROCUREMENT_WORKFLOW_STATES } from '@/types/procurement';

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
 * Canonical bare-digit id format used by Task.id (task-list-schema.ts) and
 * BacklogItem.id (backlog-schema.ts) post-15.4 migration. "ID-N" is a prose
 * convention only — JSON storage is always bare-digit.
 *
 * Roadmap ids use dotted-decimal positional ids (e.g. "9.2", "12.15.3") and
 * are NOT covered by this regex.
 */
export const BARE_ID_REGEX = /^\d+$/;

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
  // ID-131 endgame B3-ext (S447): minimal-extension action for the linear
  // review-queue "Publish" quick-action (`hooks/review/use-review-actions.ts`
  // `handlePublish`), re-pointed off the doomed `PATCH /api/items/[id]`
  // route. See `app/api/review/action/route.ts` publish branch for scope.
  'publish',
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
export const VALID_CHANGE_REPORT_FREQUENCIES = [
  'weekly',
  'daily',
  'custom',
] as const;

/**
 * PostgREST `.or(...)` predicate matching content_items on the taxonomy
 * 'unclassified' sentinel — `primary_domain = 'unclassified'` OR
 * `primary_subtopic = 'unclassified'` (the NOT NULL DEFAULT 'unclassified'
 * sentinel established by ID-63 {63.11}). Single source of truth shared by the
 * three count/filter sites that MUST stay in lockstep: the /review queue route
 * ("Unclassified" tab narrowing), the /review stats route (tab count badge),
 * and the unified dashboard taxonomy-coverage insight. ID-63.12.
 * @public
 */
export const UNCLASSIFIED_TAXONOMY_OR_PREDICATE =
  'primary_domain.eq.unclassified,primary_subtopic.eq.unclassified';

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
  // ID-131.11 G-SEARCH (§9 AC4): optional workspace scope. When supplied, the
  // route derives the `hybrid_search` `application_type` ranking profile from
  // the workspace's `application_types.key`; omitted falls through to the RPC
  // default ('procurement').
  workspace_id: z.string().uuid().optional(),
  // ID-144.6 (OBS-4 fix, TECH §2.5): server-side filters threaded to the
  // hybrid_search RPC as filter_*. Previously Zod silently stripped these
  // keys, so the BI-16 filters never reached the server. Optional — an
  // empty filter set is the default. `kind` is the display vocabulary
  // (answer|document|reference); the RPC maps it to arms, no translation
  // here. ISO-datetime so the timestamptz RPC params bind cleanly.
  kind: z.enum(['answer', 'document', 'reference']).optional(),
  domain: z.string().optional(),
  subtopic: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

/**
 * POST /api/search/reference — reference-scoped semantic search (ID-111 B-13/B-14).
 *
 * Distinct from `SearchBodySchema` (content_items-scoped /api/search): the
 * `reference_search` RPC takes only `p_query` + `p_query_embedding` + `p_limit`
 * — it has NO similarity-threshold parameter (the RPC applies its own internal
 * `embedding*0.6 + fulltext*0.4` blend and returns the raw score columns), so
 * this schema deliberately omits `threshold`. `limit` mirrors the RPC's
 * `DEFAULT 20` and is clamped to [1, 100] like the content-search schema.
 */
export const ReferenceSearchBodySchema = z.object({
  query: z.string().trim().min(1, 'Query is required').max(2000),
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
  /**
   * Optional opt-in narrowing (ID-63.12): when the literal string 'true', the
   * queue is filtered to the taxonomy 'unclassified' sentinel rows
   * (primary_domain='unclassified' OR primary_subtopic='unclassified', per
   * {63.11}) so the /review "Unclassified" tab has a populated queue. The
   * route compares the raw query-string value via
   * `searchParams.get('unclassified')==='true'` (mirroring `include_overdue`
   * / `assigned_to_me`); `z.coerce.boolean()` is unsafe because it coerces
   * the literal 'false' to true.
   */
  unclassified: z.string().optional(),
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

/** POST /api/change-reports/generate */
export const ChangeReportGenerateBodySchema = z.object({
  period_days: z.number().int().min(1).max(90).default(7),
  frequency: z.enum(VALID_CHANGE_REPORT_FREQUENCIES).default('weekly'),
  domain: z.string().optional(),
  keywords: z.array(z.string().trim().min(1)).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
});

/** GET /api/change-reports/list */
export const ChangeReportListParamsSchema = z.object({
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

/** POST /api/read-marks */
export const ReadMarkBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('mark_read'),
    item_id: z.string().uuid('item_id must be a valid UUID'),
    source: z
      .enum(['manual', 'review', 'change_report', 'bulk'])
      .default('manual'),
  }),
  z.object({
    action: z.literal('mark_unread'),
    item_id: z.string().uuid('item_id must be a valid UUID'),
  }),
  z.object({
    action: z.literal('mark_bulk_read'),
    item_ids: z.array(z.string().uuid()).min(1).max(500),
    source: z
      .enum(['manual', 'review', 'change_report', 'bulk'])
      .default('bulk'),
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

  // Ingestion source tracking. ID-107.3 — narrowed to the web-form-REACHABLE
  // allow-list: a /api/items create body may only declare a source that a
  // web form legitimately submits. `url_import` is stamped internally by
  // /api/ingest/url (IngestUrlBodySchema, set in code) and is NOT
  // web-form-reachable; route-internal/reserved sources (mcp_create,
  // bid_outcome_integration, adopted_from_reference, system-stamped
  // upload_autosplit) are stamped by their own code paths and MUST NOT be
  // acceptable from an arbitrary body.
  ingestion_source: z.enum(['manual', 'upload', 'upload_autosplit']).optional(),

  // Source document linkage (for batch creation and lineage tracking)
  source_document_id: z
    .string()
    .uuid('source_document_id must be a valid UUID')
    .optional(),

  // No-op. The on-ingest dedup pre-check this flag used to bypass was
  // retired under ID-131.15 (G-DEDUP legacy dedup-family retirement,
  // S446) — new items are always stamped 'clean'. Accepted for caller
  // backwards-compatibility only.
  skip_dedup: z.boolean().optional(),

  // S206 WP-A Phase 2 (AC3.3) — content owner override. Admin-only;
  // non-admins are silent-forced to the caller's userId via
  // `resolveContentOwnerId()` in @/lib/auth/owner-default. KBIntegrationBodySchema
  // is intentionally NOT widened (per H-4: route-side wiring only).
  content_owner_id: z.string().uuid().optional(),
});

// (ClassifyBodySchema — POST /api/items/:id/classify — was retired under
// ID-131.17 "17-final" [G-IMS-DELETE tail] alongside the deferred
// app/api/items/[id]/classify/route.ts it validated: zero remaining
// callers confirmed by rg.)

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
    // ID-59 {59.8} / PC-7 (INV-13) — edit-intent canonical vocabulary (CV).
    // Stamped onto `content_history.edit_intent` at the write site. The CV
    // (`cosmetic | data | structural`) is the SINGLE source of truth in
    // `lib/edit-intent/arbitrate.ts` (`EditIntent`); it is inlined here as a
    // `z.enum` literal so this schema file stays free of cross-module imports
    // (mirroring the `publication_status` literal above). INV-13 is enforced
    // at BOTH this Zod boundary (out-of-CV -> 400) AND the DB CHECK
    // constraint added in {59.5}. A runtime drift guard between this literal
    // and `EditIntent` lives in the {59.8} route tests.
    edit_intent: z.enum(['cosmetic', 'data', 'structural']).optional(),
    // ID-59 {59.8} — per-actor edit intents for a collaborative (CRDT) save.
    // When >=2 inputs are present the route arbitrates them (coerce each, then
    // `arbitrateMany`) and persists the raw inputs to
    // `content_history.arbitration_inputs` for audit. The per-actor `intent`
    // is intentionally a free string here: untrusted/skewed client values are
    // coerced to the unit element `'cosmetic'` by `coerceIntent` at the route,
    // NOT rejected — so a malicious participant cannot 400 a legitimate merge.
    arbitration_inputs: z
      .array(
        z.object({
          actor: z.string().max(200),
          intent: z.string().max(50),
        }),
      )
      .max(100)
      .optional(),
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

// (ItemWorkspaceBodySchema — POST /api/items/[id]/workspaces — was retired
// under ID-131.17 "17-final" [G-IMS-DELETE tail] alongside the deferred
// app/api/items/[id]/workspaces/route.ts it validated: the DB-side
// get_item_workspaces RPC drop in supabase/migrations/
// 20260704221000_id131_drop_ims_fns.sql was explicitly sequenced after
// this route's deletion.)

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
// Procurement Infrastructure Schemas (Phase 6A)
// ──────────────────────────────────────────

/** POST /api/procurement */
export const ProcurementCreateBodySchema = z.object({
  name: z.string().trim().min(1, 'Procurement name is required').max(200),
  description: z.string().max(2000).optional(),
  buyer: z.string().trim().min(1, 'Buyer name is required').max(200),
  deadline: z.string().datetime({ offset: true }).optional(),
  reference_number: z.string().max(100).optional(),
  estimated_value: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
});

/** PATCH /api/procurement/[id] */
export const ProcurementUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  buyer: z.string().trim().min(1).max(200).optional(),
  deadline: z.string().datetime({ offset: true }).nullable().optional(),
  reference_number: z.string().max(100).nullable().optional(),
  estimated_value: z.string().max(100).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  status: z.enum(PROCUREMENT_WORKFLOW_STATES).optional(),
  submission_date: z.string().datetime({ offset: true }).optional(),
  outcome: z.enum(['won', 'lost', 'withdrawn']).optional(),
  outcome_notes: z.string().max(5000).optional(),
});

/**
 * Closed list of procurement-applicable `form_type` keys (ID-130 TECH T-B12,
 * post AD-4 `pqq`->`psq` rename). This is the minimal compile-time tuple used
 * for request-body validation where Zod needs the closed set — the runtime
 * single source of truth remains the `api.form_types` CV (the picker fetches
 * its option list from there, {130.12}). The picker keeps its own client-side
 * copy (`procurementFormTypeKeys` in `components/procurement/form-type-picker`)
 * for the same compile-time-tuple reason; this server-side copy avoids pulling
 * the 'use client' picker module into API routes.
 */
export const PROCUREMENT_FORM_TYPE_KEYS = [
  'bid',
  'checklist',
  'itt',
  'psq',
  'questionnaire',
  'rfp',
  'tender',
] as const;

/**
 * POST /api/procurement/[id]/forms — add-a-form (ID-130 {130.13}, B-16/B-19).
 * The picker confirms a `form_type` (confirm-first; the route never accepts an
 * empty/inferred-but-unconfirmed type — `form_type` is required here, B-14).
 */
export const CreateProcurementFormBodySchema = z.object({
  form_type: z.enum(PROCUREMENT_FORM_TYPE_KEYS),
  name: z.string().trim().min(1).max(200).optional(),
});

/**
 * PATCH /api/procurement/[id]/forms — confirm/override an existing form's
 * inferred `form_type` (B-16: the confirmed/overridden choice is authoritative).
 */
export const UpdateProcurementFormTypeBodySchema = z.object({
  form_id: z.string().uuid(),
  form_type: z.enum(PROCUREMENT_FORM_TYPE_KEYS),
});

/** POST /api/procurement/[id]/questions/extract */
export const QuestionExtractBodySchema = z.object({
  document_path: z.string().min(1, 'Document path is required'),
  format: z.enum(['docx', 'pdf']),
});

/** POST /api/procurement/[id]/questions */
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

/** PATCH /api/procurement/[id]/questions/[qId] */
export const QuestionUpdateBodySchema = z.object({
  section_name: z.string().max(200).nullable().optional(),
  question_text: z.string().trim().min(1).max(5000).optional(),
  word_limit: z.number().int().min(1).max(100000).nullable().optional(),
  evaluation_weight: z.number().min(0).max(100).nullable().optional(),
  section_sequence: z.number().int().min(0).optional(),
  question_sequence: z.number().int().min(0).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
});

/** POST /api/procurement/[id]/questions/match */
export const QuestionMatchBodySchema = z.object({
  question_ids: z.array(z.string().uuid()).optional(),
  force: z.boolean().default(false),
});

// ──────────────────────────────────────────
// Procurement Response Schemas (Phase 6B)
// ──────────────────────────────────────────

/** POST /api/procurement/[id]/responses/draft */
export const ResponseDraftBodySchema = z.object({
  question_ids: z.array(z.string().uuid()).optional(),
  model_tier: z.enum(['analysis', 'drafting']).default('drafting'),
  force: z.boolean().default(false),
});

/** POST /api/procurement/[id]/responses/draft-stream — single question, SSE */
export const ResponseDraftStreamBodySchema = z.object({
  question_id: z.string().uuid(),
  model_tier: z.enum(['analysis', 'drafting']).default('drafting'),
});

/** POST /api/procurement/[id]/responses/draft-all */
export const ResponseDraftAllBodySchema = z.object({
  model_tier: z.enum(['analysis', 'drafting']).default('drafting'),
  skip_existing: z.boolean().default(true),
});

/** POST /api/procurement/[id]/responses/estimate */
export const CostEstimateBodySchema = z.object({
  skip_existing: z.boolean().default(true),
});

/** PATCH /api/procurement/[id]/responses/[rId] */
export const ResponseUpdateBodySchema = z.object({
  response_text: z.string().max(100000).optional(),
  response_text_advanced: z.string().max(100000).nullable().optional(),
  review_status: z
    .enum(['draft', 'ai_drafted', 'edited', 'approved', 'needs_review'])
    .optional(),
  change_reason: z.string().max(500).optional(),
  source_record_ids: z.array(z.string().uuid()).max(100).optional(),
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

/** POST /api/procurement/[id]/responses/[rId]/restore */
export const ResponseRestoreBodySchema = z.object({
  version: z.number().int().min(1),
});

/** POST /api/procurement/[id]/responses/[rId]/regenerate */
export const ResponseRegenerateBodySchema = z.object({
  instructions: z.string().trim().min(1).max(2000),
  model_tier: z.enum(['analysis', 'drafting']).default('drafting'),
});

/** POST /api/procurement/[id]/outcome */
export const ProcurementOutcomeBodySchema = z.object({
  outcome: z.enum(['won', 'lost', 'withdrawn']),
  notes: z.string().max(5000).optional(),
  integrate_to_kb: z.boolean().default(false),
});

/**
 * POST /api/procurement/[id]/outcome/integrate
 *
 * ID-131 {131.28} Part 2 (HYBRID RETIRE, OQ oq-66a0c5410864622b): this route
 * no longer writes `content_items`. The only surviving integration shape is
 * `new_entry` for `q_a_pair` — it re-points onto the UC5 promote-path write
 * shape (`app/api/q-a-pairs/promote/route.ts`), creating a DRAFT `q_a_pairs`
 * row. `update_existing` and the 4 non-QA content types (case_study, policy,
 * methodology, capability) are RETIRED — those knowledge types re-enter later
 * as id-132 CONCEPT-proposals (re-entry intent, not this Subtask).
 */
export const KBIntegrationBodySchema = z.object({
  integrations: z.array(
    z.object({
      question_id: z.string().uuid(),
      action: z.enum(['new_entry', 'skip']),
    }),
  ),
  /**
   * No-op. The exact-hash skip-and-log pre-insert dedup check this flag
   * used to bypass was retired under ID-131.15 (G-DEDUP legacy
   * dedup-family retirement, S446). Accepted for caller
   * backwards-compatibility only.
   */
  skip_dedup: z.boolean().optional(),
});

/**
 * Runtime validation for workspaces.domain_metadata when type='bid'
 * @public
 */
export const ProcurementMetadataSchema = z
  .object({
    buyer: z.string(),
    status: z.enum(PROCUREMENT_WORKFLOW_STATES),
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

/**
 * Parse and validate `workspaces.domain_metadata` for procurement workspaces.
 *
 * `domain_metadata` is the canonical WORKSPACE-LEVEL home for engagement fields
 * (buyer/deadline/status): populated by the create path (POST /api/procurement)
 * and KEPT by the {130.8} data migration, which lifts a COPY onto `form_templates`
 * for the form-altitude model — it does NOT move the data out. So `null`/`undefined`
 * means a workspace with NO engagement metadata set (e.g. bare/ambient rows) — a
 * VALID "absent" state, not a malformed one. Treat absent as "no metadata" (return
 * `null`, no warning); only a PRESENT-but-malformed value is genuinely invalid and
 * worth a warn.
 */
export function parseProcurementMetadata(
  raw: unknown,
): z.infer<typeof ProcurementMetadataSchema> | null {
  if (raw == null) return null;
  const result = ProcurementMetadataSchema.safeParse(raw);
  if (!result.success) {
    logger.warn({ err: result.error.format() }, 'Invalid procurement metadata');
    return null;
  }
  return result.data;
}

// ──────────────────────────────────────────
// Form outcome validation (ID-130 AD-4)
// ──────────────────────────────────────────

/**
 * Per-stage `form_type` sets — the compile-time mirror of the
 * `form_outcome_types` CV's `applicable_form_types` (ID-130 AD-4). A form's
 * STAGE (shortlist vs final-award) determines which outcome values it may
 * carry. The DB CV is the source of truth (FK `form_templates.outcome →
 * form_outcome_types.key`); these tuples + `FormOutcomeSchema` are the
 * app-layer mirror that enforces the *stage-appropriate subset* (a `psq` form
 * may only resolve to a shortlist outcome). Adding an outcome value or shifting
 * a form-type's stage is a CV row edit that moves WITH these tuples — there is
 * no frozen CHECK to migrate.
 *
 * @public
 */
export const FINAL_AWARD_FORM_TYPES = ['itt', 'tender', 'bid', 'rfp'] as const;
/** Shortlist-stage form types (mirror of `form_outcome_types.applicable_form_types`). @public */
export const SHORTLIST_FORM_TYPES = [
  'psq',
  'questionnaire',
  'checklist',
] as const;

/** Final-award outcomes — these ENTER the win-rate denominator (`counts_toward_win_rate=true`). @public */
export const FINAL_AWARD_OUTCOMES = ['won', 'lost'] as const;
/** Shortlist outcomes — resolve the engagement but do NOT enter the win-rate denominator. @public */
export const SHORTLIST_OUTCOMES = ['shortlisted', 'not_shortlisted'] as const;

/**
 * Union of the four seeded `form_outcome_types.key` values across both stages.
 * @public
 */
export type FormOutcomeValue =
  | (typeof FINAL_AWARD_OUTCOMES)[number]
  | (typeof SHORTLIST_OUTCOMES)[number];

const finalAwardFormFields = {
  workflow_state: z.enum(PROCUREMENT_WORKFLOW_STATES),
  outcome: z.enum(FINAL_AWARD_OUTCOMES).nullable(),
};
const shortlistFormFields = {
  workflow_state: z.enum(PROCUREMENT_WORKFLOW_STATES),
  outcome: z.enum(SHORTLIST_OUTCOMES).nullable(),
};

/**
 * Validates a procurement form's `{form_type, workflow_state, outcome}` triad,
 * discriminated on `form_type` so the *stage-appropriate* outcome subset is
 * enforced (ID-130 AD-4 / B-5): final-award forms (`{itt,tender,bid,rfp}`)
 * carry `won`/`lost`; shortlist forms (`{psq,questionnaire,checklist}`) carry
 * `shortlisted`/`not_shortlisted`. `withdrawn` is a `workflow_state` TERMINAL,
 * not an outcome — a withdrawn form has `workflow_state='withdrawn'` and
 * `outcome=null` (B-8/B-9). `sales_proposal_template` is intentionally absent:
 * it is a sales-domain form with no procurement outcome stage.
 *
 * @public
 */
export const FormOutcomeSchema = z.discriminatedUnion('form_type', [
  z.object({ form_type: z.literal('itt'), ...finalAwardFormFields }),
  z.object({ form_type: z.literal('tender'), ...finalAwardFormFields }),
  z.object({ form_type: z.literal('bid'), ...finalAwardFormFields }),
  z.object({ form_type: z.literal('rfp'), ...finalAwardFormFields }),
  z.object({ form_type: z.literal('psq'), ...shortlistFormFields }),
  z.object({ form_type: z.literal('questionnaire'), ...shortlistFormFields }),
  z.object({ form_type: z.literal('checklist'), ...shortlistFormFields }),
]);

/**
 * Inferred type of a validated procurement form outcome triad.
 * @public
 */
export type FormOutcome = z.infer<typeof FormOutcomeSchema>;

/** Known procurement form types (mirror of the `form_outcome_types` CV stages). */
export const KNOWN_FORM_TYPES = new Set<string>([
  ...FINAL_AWARD_FORM_TYPES,
  ...SHORTLIST_FORM_TYPES,
]);

/**
 * App-layer mirror of the DB `form_templates_outcome_form_type_check` trigger
 * (ID-130 AD-4 / T-B5). Returns a human-readable error string if the outcome is
 * not stage-appropriate for the form_type, or `null` when the triad is valid (or
 * the form_type is unclassified — the DB FK + trigger remain the backstop).
 *
 * Co-located here (not inline in the route handlers) so the route files stay
 * free of inline `.safeParse(` — the validation-sweep guard requires
 * route-body validation to go through parseBody/parseSearchParams; this is
 * domain-triad validation of a constructed object, which belongs in the schema
 * module alongside FormOutcomeSchema.
 *
 * @public
 */
export function validateFormOutcome(
  formType: string | null,
  workflowState: string,
  outcome: string | null,
): string | null {
  if (!formType || !KNOWN_FORM_TYPES.has(formType)) return null;
  const result = FormOutcomeSchema.safeParse({
    form_type: formType,
    workflow_state: workflowState,
    outcome,
  });
  if (!result.success) {
    return `Outcome "${outcome ?? 'null'}" is not valid for a "${formType}" form`;
  }
  return null;
}

// ──────────────────────────────────────────
// Procurement Export Schemas (Phase 7A)
// ──────────────────────────────────────────

/** POST /api/procurement/[id]/export/docx */
export const DocxExportBodySchema = z.object({
  include_cover: z.boolean().default(true),
  include_toc: z.boolean().default(true),
  include_citations: z.boolean().default(true),
  include_unanswered: z.boolean().default(true),
  use_advanced_variant: z.boolean().default(false),
  company_name: z.string().max(200).default(BRANDING.productName),
});

/** POST /api/procurement/[id]/export/xlsx */
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
   * Stored on `intelligence_workspaces.relevance_threshold` typed column
   * (post-T2 / S246; pre-T2 was `workspaces.domain_metadata.relevance_threshold` JSONB).
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

/** POST /api/oauth/revoke */
export const RevokeSchema = z.object({
  clientId: z.string().uuid('Invalid client ID'),
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
  status: z
    .enum([
      'running',
      'in_progress',
      'completed',
      'completed_with_errors',
      'failed',
      'cancelled',
    ])
    .optional(),
  all: booleanParam.optional(),
});

/** GET /api/procurement */
export const ProcurementListParamsSchema = z.object({
  status: z.enum(PROCUREMENT_WORKFLOW_STATES).optional(),
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

// `include: 'stats'` (get_guide_coverage() RPC enrichment) was retired under
// ID-131.19 fix-Executor escalation 2b (DR-034 owner ruling) — see
// app/api/guides/route.ts's header comment.
export const GuideListParamsSchema = z.object({
  type: z.enum(VALID_GUIDE_TYPES).optional(),
  include_unpublished: booleanParam.optional(),
});

// WorkspaceItemsParamsSchema RETIRED (ID-131.19, M6, S450 GO tail) — its sole
// consumer, GET /api/workspaces/[id]/items, was deleted (content_item_workspaces
// junction table dropped, no production caller).

/** GET /api/workspaces */
export const WorkspaceListParamsSchema = z.object({
  include_archived: booleanParam.optional(),
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

/** GET /api/procurement/[id]/tender/download */
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

// (ArchiveBodySchema — POST /api/items/[id]/archive — was retired under
// ID-131.17 "17-final" [G-IMS-DELETE tail] alongside the deferred
// app/api/items/[id]/archive/route.ts it validated: zero remaining callers
// confirmed by rg.)

// (The §1.7 Admin Cross-System Dedup Review (S211B) and §1.9 Near-Duplicate
// Merge Dashboard (S212B) request-body/query schemas that used to live here
// — DedupQueueQuerySchema, DedupActionBodySchema, DedupSupersedeBodySchema,
// NearDupPairsQuerySchema, NearDupConfirmUniqueBodySchema,
// NearDupMergeBodySchema — were retired under ID-131.15 (G-DEDUP legacy
// dedup-family retirement, S446) alongside the admin content-dedup routes
// they validated.)

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

// ──────────────────────────────────────────
// BEGIN generated: R-WP17 ResponseSchema constants (ID-32.20)
// Source: scripts/codemods/generate-response-schemas.ts — DO NOT hand-edit.
// Re-run: bun scripts/codemods/generate-response-schemas.ts --write
// ──────────────────────────────────────────
//
// 31 R-WP17 response-schema constants (37 minus the 6 Dedup/NearDup
// constants retired under ID-131.15). Each validates the
// matching route handler's return payload (AC-8) and is resolved by
// Source-A inference via the `${interface}Schema` name convention.
//
// Strictness derives from the REAL source interfaces (INV-S, TECH §3.1a):
// bare z.object strips additive wire fields but REJECTS a renamed/removed/
// retyped declared field. .loose()/z.unknown() appear ONLY where allow-listed.
//

// ── INV-S allow-list manifest (TECH §3.1a) ──
// Every .loose() and z.unknown() below is justified by a real source
// property: a genuine [k: string]: T index signature, an opaque Json/DB
// member, a bare `unknown`, or an un-narrowable external/generic type.
// The INV-S static guard asserts one entry per permissive token (5).
// ALLOW: z.unknown @ ReviewQueueResponse.items[].metadata{} — unknown (unknown)
// ALLOW: z.unknown @ EntityDetail.metadata{} — unknown (unknown)
// ALLOW: z.unknown @ IntelligenceWorkspace.domain_metadata — Json (supabase-Json)
// ALLOW: .loose @ PipelineRunRow.progress — index-signature ([k: string]: unknown)
// ALLOW: z.unknown @ PipelineRunRow.result — unknown (unknown)

/** R-WP17 ResponseSchema for `ChangeReportGenerateResponse` (types/change-reports.ts). Generated; strict per INV-S (TECH §3.1a). */
export const ChangeReportGenerateResponseSchema = z.object({
  digest: z.object({
    id: z.string(),
    frequency: z.string(),
    period_start: z.string(),
    period_end: z.string(),
    item_count: z.number(),
    domain_summaries: z.array(
      z.object({
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
      }),
    ),
    narrative_summary: z.string().nullable(),
    generated_at: z.string(),
    generated_by: z.string(),
    tokens_used: z.number().nullable(),
    item_ids: z.array(z.string()).optional(),
    filters: z
      .object({
        domain: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
      })
      .nullable()
      .optional(),
    governance_summary: z
      .object({
        items_modified: z.number(),
        items_verified: z.number(),
        items_flagged: z.number(),
        freshness_breakdown: z
          .object({
            fresh: z.number(),
            aging: z.number(),
            stale: z.number(),
            expired: z.number(),
          })
          .optional(),
      })
      .nullable()
      .optional(),
    created_at: z.string(),
  }),
});

/** R-WP17 ResponseSchema for `RescoringPreviewResponse` (types/intelligence-refinement.ts). Generated; strict per INV-S (TECH §3.1a). */
export const RescoringPreviewResponseSchema = z.object({
  samples: z.number(),
  mean_delta: z.number(),
  improved: z.number(),
  regressed: z.number(),
  results: z.array(
    z.object({
      article_id: z.string(),
      title: z.string(),
      existing_score: z.number().nullable(),
      candidate_score: z.number(),
      score_delta: z.number(),
      existing_reasoning: z.string().nullable().optional(),
      candidate_reasoning: z.string().optional(),
    }),
  ),
  warnings: z.array(z.string()).optional(),
});

/** R-WP17 ResponseSchema for `ResolveFlagsResponse` (types/intelligence-refinement.ts). Generated; strict per INV-S (TECH §3.1a). */
export const ResolveFlagsResponseSchema = z.object({
  resolved_count: z.number(),
  requested_count: z.number(),
  warnings: z.array(z.string()).optional(),
});

/** R-WP17 ResponseSchema for `AnalyseFlagsResponse` (types/intelligence-refinement.ts). Generated; strict per INV-S (TECH §3.1a). */
export const AnalyseFlagsResponseSchema = z.object({
  summary: z.string(),
  falsePositivePatterns: z.array(
    z.object({
      pattern: z.string(),
      articleCount: z.number(),
      articles: z.array(z.string()),
      rootCause: z.string(),
    }),
  ),
  falseNegativePatterns: z.array(
    z.object({
      pattern: z.string(),
      articleCount: z.number(),
      articles: z.array(z.string()),
      rootCause: z.string(),
    }),
  ),
  recommendations: z.array(
    z.object({
      type: z.enum(['add', 'remove', 'reword']),
      section: z.string(),
      currentText: z.string().nullable(),
      proposedText: z.string(),
      reasoning: z.string(),
      affectedFlags: z.number(),
    }),
  ),
  proposedPromptText: z.string(),
  confidenceNotes: z.string(),
  analysedFlagCount: z.number(),
  truncated: z.boolean(),
});

/** R-WP17 ResponseSchema for `ReviewQueueResponse` (types/review.ts). Generated; strict per INV-S (TECH §3.1a). */
export const ReviewQueueResponseSchema = z.object({
  items: z.array(
    z.object({
      content: z.string().nullable(),
      source_url: z.string().nullable(),
      verified_at: z.string().nullable(),
      verified_by: z.string().nullable(),
      secondary_domain: z.string().nullable(),
      secondary_subtopic: z.string().nullable(),
      quality_score: z.number().nullable(),
      last_reviewed_at: z.string().nullable(),
      id: z.string(),
      title: z.string(),
      suggested_title: z.string().nullable(),
      summary: z.string().nullable(),
      primary_domain: z.string().nullable(),
      primary_subtopic: z.string().nullable(),
      content_type: z.string(),
      platform: z.string().nullable(),
      author_name: z.string().nullable(),
      source_domain: z.string().nullable(),
      thumbnail_url: z.string().nullable(),
      captured_date: z.string().nullable(),
      ai_keywords: z.array(z.string()).nullable(),
      classification_confidence: z.number().nullable(),
      priority: z.string().nullable(),
      freshness: z.string().nullable(),
      user_tags: z.array(z.string()).nullable(),
      governance_review_status: z.string().nullable(),
      metadata: z.record(z.string(), z.unknown()).nullable(),
      source_document: z.string().nullable().optional(),
      brief: z.string().nullable().optional(),
      answer_standard: z.string().nullable().optional(),
      answer_advanced: z.string().nullable().optional(),
      content_owner_id: z.string().nullable().optional(),
      source_document_id: z.string().nullable().optional(),
      citation_count: z.number().nullable().optional(),
      source_file: z.string().nullable().optional(),
      layer: z.string().nullable().optional(),
      starred: z.boolean().optional(),
      next_review_date: z.string().nullable().optional(),
      review_cadence_days: z.number().nullable().optional(),
      publication_status: z
        .enum(['draft', 'in_review', 'published', 'archived'])
        .nullable(),
    }),
  ),
  total: z.number(),
  verified_count: z.number(),
  flagged_count: z.number(),
  has_more: z.boolean(),
});

/** R-WP17 ResponseSchema for `ReviewStatsResponse` (types/review.ts). Generated; strict per INV-S (TECH §3.1a). */
export const ReviewStatsResponseSchema = z.object({
  total: z.number(),
  verified: z.number(),
  flagged: z.number(),
  unverified: z.number(),
  draft: z.number(),
  overdue: z.number(),
  awaiting_publication: z.number(),
  by_domain: z.record(
    z.string(),
    z.object({
      total: z.number(),
      verified: z.number(),
    }),
  ),
  by_content_type: z.record(
    z.string(),
    z.object({
      total: z.number(),
      verified: z.number(),
    }),
  ),
  by_source_file: z.record(
    z.string(),
    z.object({
      total: z.number(),
      verified: z.number(),
    }),
  ),
  by_source_document: z.record(
    z.string(),
    z.object({
      total: z.number(),
      verified: z.number(),
      name: z.string(),
    }),
  ),
});

// (R-WP17 ResponseSchemas for DedupQueueResponse, DedupItemResponse,
// NearDupPairsResponse, NearDupMergeResult, NearDupConfirmUniqueResult —
// generated from lib/query/fetchers.ts types that were retired under
// ID-131.15, alongside the admin content-dedup routes they validated.)

/** R-WP17 ResponseSchema for `PipelineRunsRecentResponse` (app/api/admin/pipeline-runs/recent/route.ts). Generated; strict per INV-S (TECH §3.1a). */
export const PipelineRunsRecentResponseSchema = z.object({
  windowHours: z.number(),
  generatedAt: z.string(),
  summaries: z.array(
    z.object({
      pipelineName: z.string(),
      runCount: z.number(),
      failureCount: z.number(),
      completedWithErrorsCount: z.number(),
      lastRunAt: z.string().nullable(),
      lastRunStatus: z.string().nullable(),
      lastFailureAt: z.string().nullable(),
      lastFailureMessage: z.string().nullable(),
    }),
  ),
  totalRuns: z.number(),
  totalFailures: z.number(),
  hasAnyFailures: z.boolean(),
});

/** R-WP17 ResponseSchema for `BatchCreateResult` (hooks/use-batch-create.ts). Generated; strict per INV-S (TECH §3.1a). */
export const BatchCreateResultSchema = z.object({
  created: z.number(),
  failed: z.number(),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(['created', 'failed']),
      error: z.string().optional(),
    }),
  ),
  pipeline_run_id: z.string().nullable(),
  batch_id: z.string(),
});

/** R-WP17 ResponseSchema for `SendToReviewResult` (hooks/use-diff-review.ts). Generated; strict per INV-S (TECH §3.1a). */
export const SendToReviewResultSchema = z.object({
  sent: z.number(),
  already_pending: z.number(),
  skipped_draft: z.number(),
  review_url: z.string(),
  // ID-131.19 Blocker 2 fix: ids requested but with no record_lifecycle
  // facet row (system-wide gap until the Phase 2 facet-mint migration
  // ships) — surfaced explicitly so total_requested is always accounted
  // for across sent + already_pending + skipped_draft + no_governance_record.
  no_governance_record: z.array(z.string()).optional(),
});

/** R-WP17 ResponseSchema for `EntityDetail` (hooks/use-entity-detail.ts). Generated; strict per INV-S (TECH §3.1a). */
export const EntityDetailSchema = z.object({
  canonical_name: z.string(),
  entity_type: z.string(),
  effective_type: z.string(),
  has_type_override: z.boolean(),
  mention_count: z.number(),
  variant_names: z.array(z.string()),
  variant_count: z.number(),
  types_seen: z.array(z.string()),
  has_type_conflict: z.boolean(),
  content_items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      content_type: z.string().nullable(),
    }),
  ),
  content_item_count: z.number(),
  relationships: z.array(
    z.object({
      source_entity: z.string(),
      relationship_type: z.string(),
      target_entity: z.string(),
      confidence: z.number(),
    }),
  ),
  relationship_count: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** R-WP17 ResponseSchema for `NotificationsResponse` (hooks/use-notifications.ts). Generated; strict per INV-S (TECH §3.1a). */
export const NotificationsResponseSchema = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      user_id: z.string(),
      type: z.string(),
      entity_type: z.string(),
      entity_id: z.string(),
      title: z.string(),
      message: z.string().nullable(),
      read_at: z.string().nullable(),
      dismissed_at: z.string().nullable(),
      expires_at: z.string().nullable(),
      created_at: z.string().nullable(),
    }),
  ),
  unreadCount: z.number(),
});

/** R-WP17 ResponseSchema for `MutationResult` (hooks/use-tags-data.ts). Generated; strict per INV-S (TECH §3.1a). */
export const MutationResultSchema = z.object({
  affected: z.number(),
});

/** R-WP17 ResponseSchema for `PatchResponse` (components/review/publication-review-action-bar.tsx). Generated; strict per INV-S (TECH §3.1a). */
export const PatchResponseSchema = z.object({
  success: z.boolean(),
  previousStatus: z.string(),
  newStatus: z.string(),
  transition: z.string(),
});

/** R-WP17 ResponseSchema for `ReadinessData` (hooks/procurement/use-procurement-readiness.ts). Generated; strict per INV-S (TECH §3.1a). */
export const ReadinessDataSchema = z.object({
  ready: z.boolean(),
  summary: z.object({
    total_questions: z.number(),
    answered: z.number(),
    approved: z.number(),
    quality_checked: z.number(),
    passing_quality: z.number(),
  }),
  criteria: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      details: z.string(),
    }),
  ),
  issues: z.array(
    z.object({
      question_number: z.number(),
      question_title: z.string(),
      issues: z.array(z.string()),
    }),
  ),
});

/** R-WP17 ResponseSchema for `ProcurementResponse` (hooks/streaming/use-stream-coordination.ts). Generated; strict per INV-S (TECH §3.1a). */
export const ProcurementResponseSchema = z.object({
  id: z.string(),
  question_id: z.string(),
  response_text: z.string().nullable(),
  response_text_advanced: z.string().nullable(),
  version: z.number(),
  citations: z.array(
    z.object({
      cited_text: z.string(),
      source_index: z.number(),
      source_id: z.string(),
      source_title: z.string(),
      source_url: z.string(),
      start_block_index: z.number(),
      end_block_index: z.number(),
    }),
  ),
  source_content: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      content_type: z.string().nullable(),
      primary_domain: z.string().nullable(),
      primary_subtopic: z.string().nullable(),
      summary: z.string().nullable(),
      similarity: z.number().optional(),
    }),
  ),
  quality_check: z
    .object({
      overall_score: z.number(),
      word_count: z.number(),
      word_limit_compliance: z.boolean(),
      citation_count: z.number(),
      unsupported_claims: z.array(z.string()),
      suggestions: z.array(z.string()),
      issues: z.array(
        z.object({
          type: z.enum([
            'word_limit',
            'unsupported_claim',
            'weak_language',
            'missing_section',
          ]),
          severity: z.enum(['error', 'warning', 'info']),
          message: z.string(),
          location: z.string().optional(),
        }),
      ),
    })
    .nullable(),
  review_status: z.string(),
  question: z.object({
    question_text: z.string(),
    word_limit: z.number().nullable(),
    section_name: z.string().nullable(),
    confidence_posture: z.string().nullable(),
  }),
});

/** R-WP17 ResponseSchema for `CompanyProfile` (hooks/intelligence/use-company-profiles.ts). Generated; strict per INV-S (TECH §3.1a). */
export const CompanyProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  website_url: z.string().nullable(),
  sectors: z.array(z.string()),
  services: z.array(z.string()),
  certifications: z.array(z.string()),
  geographic_scope: z.array(z.string()),
  competitors: z.array(
    z.object({
      name: z.string(),
      website: z.string().optional(),
      notes: z.string().optional(),
    }),
  ),
  target_customers: z.string().nullable(),
  value_proposition: z.string().nullable(),
  key_topics: z.array(z.string()),
  is_active: z.boolean(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** R-WP17 ResponseSchema for `ArticlesResponse` (hooks/intelligence/use-feed-articles.ts). Generated; strict per INV-S (TECH §3.1a). */
export const ArticlesResponseSchema = z.object({
  articles: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      external_url: z.string(),
      relevance_score: z.number().nullable(),
      relevance_category: z
        .enum(['high', 'medium', 'low', 'irrelevant'])
        .nullable(),
      relevance_reasoning: z.string().nullable(),
      ai_summary: z.string().nullable(),
      ingested_at: z.string(),
      published_at: z.string().nullable(),
      // content_item_id RETIRED (ID-131.19, M6) — feed_articles.content_item_id
      // (the content_items FK column) was dropped; no consumer rendered it.
      passed: z.boolean(),
      source_name: z.string().nullable(),
      flag_count: z.number(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

/** R-WP17 ResponseSchema for `FeedFlag` (hooks/intelligence/use-feed-articles.ts). Generated; strict per INV-S (TECH §3.1a). */
export const FeedFlagSchema = z.object({
  id: z.string(),
  feed_article_id: z.string(),
  flag_type: z.enum(['false_positive', 'false_negative']),
  flagged_by: z.string(),
  notes: z.string().nullable(),
  resolved: z.boolean(),
  resolved_at: z.string().nullable(),
  prompt_version_id: z.string().nullable(),
  created_at: z.string(),
});

/** R-WP17 ResponseSchema for `FeedPrompt` (hooks/intelligence/use-feed-prompts.ts). Generated; strict per INV-S (TECH §3.1a). */
export const FeedPromptSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  version: z.number(),
  prompt_text: z.string(),
  is_active: z.boolean(),
  performance_snapshot: z
    .object({
      total_articles: z.number(),
      passed_articles: z.number(),
      filtered_articles: z.number(),
      pass_rate: z.number(),
      captured_at: z.string(),
      period: z.string(),
    })
    .nullable(),
  change_notes: z.string().nullable(),
  created_at: z.string(),
  created_by: z.string().nullable(),
});

/** R-WP17 ResponseSchema for `CreateFeedSourceResponse` (hooks/intelligence/use-feed-sources.ts). Generated; strict per INV-S (TECH §3.1a). */
export const CreateFeedSourceResponseSchema = z.object({
  feed_title: z.string().optional(),
  initial_article_count: z.number().optional(),
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  url: z.string(),
  source_type: z.enum(['rss', 'web', 'api']).optional(),
  polling_interval_minutes: z.number(),
  is_active: z.boolean(),
  last_polled_at: z.string().nullable(),
  last_status: z.string().nullable(),
  consecutive_failures: z.number(),
  etag: z.string().nullable(),
  last_modified: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** R-WP17 ResponseSchema for `FeedSource` (hooks/intelligence/use-feed-sources.ts). Generated; strict per INV-S (TECH §3.1a). */
export const FeedSourceSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  url: z.string(),
  source_type: z.enum(['rss', 'web', 'api']).optional(),
  polling_interval_minutes: z.number(),
  is_active: z.boolean(),
  last_polled_at: z.string().nullable(),
  last_status: z.string().nullable(),
  consecutive_failures: z.number(),
  etag: z.string().nullable(),
  last_modified: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** R-WP17 ResponseSchema for `TestPollResult` (hooks/intelligence/use-feed-sources.ts). Generated; strict per INV-S (TECH §3.1a). */
export const TestPollResultSchema = z.object({
  success: z.boolean(),
  itemCount: z.number(),
  sampleTitles: z.array(z.string()),
  error: z.string().optional(),
});

/** R-WP17 ResponseSchema for `MetricsSummary` (hooks/intelligence/use-intelligence-metrics.ts). Generated; strict per INV-S (TECH §3.1a). */
export const MetricsSummarySchema = z.object({
  total_articles: z.number(),
  passed_articles: z.number(),
  filtered_articles: z.number(),
  filter_ratio: z.number(),
  total_flags: z.number(),
  false_positive_flags: z.number(),
  false_negative_flags: z.number(),
  unresolved_flags: z.number(),
  last_poll_time: z.string().nullable(),
  active_sources: z.number(),
  sources_with_errors: z.number(),
  recent_flags: z.array(
    z.object({
      id: z.string(),
      flag_type: z.enum(['false_positive', 'false_negative']),
      notes: z.string().nullable(),
      created_at: z.string(),
      article_title: z.string(),
    }),
  ),
  period: z.string(),
});

/** R-WP17 ResponseSchema for `IntelligenceWorkspace` (hooks/intelligence/use-intelligence-workspaces.ts). Generated; strict per INV-S (TECH §3.1a). */
export const IntelligenceWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  application_type_id: z.string(),
  company_profile_id: z.string().nullable(),
  guide_id: z.string().nullable(),
  relevance_threshold: z.number().nullable(),
  domain_metadata: z.unknown(),
  is_archived: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  company_profile_name: z.string().optional(),
  source_count: z.number().optional(),
  article_count: z.number().optional(),
  passed_article_count: z.number().optional(),
});

/** R-WP17 ResponseSchema for `SeedStarterPackResult` (hooks/intelligence/use-seed-starter-pack.ts). Generated; strict per INV-S (TECH §3.1a). */
export const SeedStarterPackResultSchema = z.object({
  starter_pack_id: z.string(),
  starter_pack_name: z.string(),
  seeded: z.array(z.string()),
  skipped_existing: z.array(z.string()),
  failed: z.array(
    z.object({
      url: z.string(),
      error: z.string(),
    }),
  ),
  warnings: z.array(z.string()).optional(),
});

/** R-WP17 ResponseSchema for `TriggerPollResponse` (hooks/intelligence/use-trigger-poll.ts). Generated; strict per INV-S (TECH §3.1a). */
export const TriggerPollResponseSchema = z.object({
  success: z.boolean(),
  runId: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  sourcesProcessed: z.number(),
  totalArticlesFound: z.number(),
  totalArticlesNew: z.number(),
  totalArticlesPassed: z.number(),
  errors: z.array(z.string()),
});

/** R-WP17 ResponseSchema for `WorkspaceHealthResponse` (hooks/intelligence/use-workspace-health.ts). Generated; strict per INV-S (TECH §3.1a). */
export const WorkspaceHealthResponseSchema = z.object({
  pipeline: z.object({
    lastSuccessfulRun: z.string().nullable(),
    timeSinceLastRunMs: z.number().nullable(),
    sourcesWithFailures: z.number(),
    sourcesAtFailureLimit: z.number(),
    totalActiveSources: z.number(),
    healthy: z.boolean(),
    statusMessage: z.string(),
  }),
  sources: z.object({
    workspaceId: z.string(),
    sources: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.string(),
        lastPolledAt: z.string().nullable(),
        lastPolledStatus: z.string().nullable(),
        lastPolledError: z.string().nullable(),
        consecutiveFailures: z.number(),
        pollingIntervalMinutes: z.number(),
        articleCount: z.number(),
      }),
    ),
    healthySources: z.number(),
    failingSources: z.number(),
    disabledSources: z.number(),
  }),
});

/** R-WP17 ResponseSchema for `AssignmentsResponse` (hooks/review/use-review-queue-data.ts). Generated; strict per INV-S (TECH §3.1a). */
export const AssignmentsResponseSchema = z.object({
  assignments: z.array(
    z.object({
      id: z.string(),
      notes: z.string().nullable(),
      filter_domains: z.array(z.string()).nullable(),
      filter_content_types: z.array(z.string()).nullable(),
      filter_freshness: z.array(z.string()).nullable(),
      filter_date_from: z.string().nullable(),
      filter_date_to: z.string().nullable(),
      item_count: z.number().nullable(),
      due_date: z.string().nullable(),
    }),
  ),
});

/** R-WP17 ResponseSchema for `TaxonomySyncStatus` (lib/query/fetchers.ts). Generated; strict per INV-S (TECH §3.1a). */
export const TaxonomySyncStatusSchema = z.object({
  in_sync: z.boolean(),
  last_sync_at: z.string().nullable(),
  current_hash: z.string(),
  synced_hash: z.string().nullable(),
});

/** R-WP17 ResponseSchema for `PipelineRunRow` (lib/query/fetchers.ts). Generated; strict per INV-S (TECH §3.1a). */
export const PipelineRunRowSchema = z.object({
  id: z.string(),
  pipeline_name: z.string(),
  status: z.enum([
    'failed',
    'running',
    'in_progress',
    'completed',
    'completed_with_errors',
    'cancelled',
  ]),
  progress: z
    .object({
      step: z.string().optional(),
      steps_completed: z.number().optional(),
      steps_total: z.number().optional(),
      files_completed: z.number().optional(),
      files_total: z.number().optional(),
      detail: z.string().optional(),
    })
    .loose()
    .nullable(),
  source_filename: z.string().nullable(),
  items_created: z.array(z.string()).nullable(),
  items_processed: z.number().nullable(),
  workspace_id: z.string().nullable(),
  error_message: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string().nullable(),
  created_by: z.string().nullable(),
  result: z.unknown(),
});

// (R-WP17 ResponseSchema for `NearDupPairDetail` retired under ID-131.15
// alongside the admin near-duplicates detail route it validated.)

// ──────────────────────────────────────────
// END generated: R-WP17 ResponseSchema constants (ID-32.20)
// ──────────────────────────────────────────

// ──────────────────────────────────────────
// HAND-AUTHORED ResponseSchema constants (ID-32.28 — defect-B5 binding fix)
// ──────────────────────────────────────────
//
// These correct the wrong bindings the 32.20 Source-A URL-matcher produced for
// routes whose real 2xx body describes a DIFFERENT entity than the inferred
// `${interface}Schema`. They live OUTSIDE the generated block above (which
// {32.26} regenerates) and are bound to their routes via a route+method
// override in `scripts/codemods/inference-source-a.ts` (precedence over the
// heuristic chain) so the {32.27} temp-copy `--apply` emits the CORRECT
// `defineRoute(...)` schema. Each shape is verified against the handler's
// success return — no invented fields, no `.loose()`-masking of a real
// mismatch (where `.loose()` IS used it permits genuinely-heterogeneous-but-
// valid sibling fields, never papers over an absent required key). Permissive
// on extra keys per AC-8.
//
// NOTE (OQ-10 re-scope): the working-tree routes are deliberately NOT wrapped
// in this Subtask — the full corpus rollout that applies these bindings to the
// live route files is Task ID-49. These schemas are consumed by the {32.27}
// temp-copy gate, the codemod override, and the ID-32.28 binding-correctness
// test today.
//
// Spec: docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PLAN.md §0; task-list.json
// ID-32.28.

/**
 * ResponseSchema for `GET /api/entities/co-occurrence` (defect-B5 fix). The
 * route returns `{ pairs, total }` where each pair is a row from the
 * `get_entity_co_occurrence` RPC (`{ entity_a, entity_b, shared_count, type_a,
 * type_b }` per `supabase/types/database.types.ts`). The 32.20 codemod
 * wrongly bound `EntityDetailSchema` (an unrelated single-entity-detail shape).
 */
export const EntityCoOccurrenceResponseSchema = z
  .object({
    pairs: z.array(
      z
        .object({
          entity_a: z.string(),
          entity_b: z.string(),
          shared_count: z.number(),
          type_a: z.string(),
          type_b: z.string(),
        })
        .loose(),
    ),
    total: z.number(),
  })
  .loose();

/**
 * ResponseSchema for `POST /api/items/batch-review` (defect-B5 fix). Returns
 * `{ updated }` — the count of items whose governance_review_status changed.
 * The 32.20 codemod wrongly bound `PatchResponseSchema`
 * (`{ success, previousStatus, newStatus, transition }`).
 */
export const BatchReviewResponseSchema = z
  .object({
    updated: z.number(),
  })
  .loose();

/**
 * ResponseSchema for `POST /api/items/batch-workspaces` (defect-B5 fix).
 * Returns `{ assignments }`, a `Record<string, string[]>` grouping
 * content-item ids to their workspace ids. The 32.20 codemod wrongly bound
 * `PatchResponseSchema`.
 */
export const BatchWorkspacesResponseSchema = z
  .object({
    assignments: z.record(z.string(), z.array(z.string())),
  })
  .loose();

/**
 * ResponseSchema for `PATCH /api/items/[id]` (defect-B5 fix). The handler is
 * polymorphic: every 2xx branch returns `{ success: true, ... }`, with the
 * remaining fields varying by branch — status-transition
 * (`previousStatus`/`newStatus`/`transition`), supersession-clear
 * (`superseded_by`/`dedup_status`), supersession-set (`old_item`/`new_item`),
 * or a plain `{ success: true }` (+ optional `warnings`) via
 * `warningsEnvelope`. `success` is the genuine shared invariant; `.loose()`
 * admits the legitimate per-branch sibling fields (NOT a masked mismatch). The
 * 32.20 codemod bound `PatchResponseSchema`, which forced
 * `previousStatus`/`newStatus`/`transition` on every branch.
 */
export const ItemPatchResponseSchema = z
  .object({
    success: z.boolean(),
  })
  .loose();

/**
 * ResponseSchema for `DELETE /api/items/[id]` (defect-B5 fix). Returns
 * `{ deleted, id }`. The 32.20 codemod bound `PatchResponseSchema`.
 */
export const ItemDeleteResponseSchema = z
  .object({
    deleted: z.boolean(),
    id: z.string(),
  })
  .loose();
// ──────────────────────────────────────────
