import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseSearchParams } from '@/lib/validation';
import {
  PublicationReviewQueueParamsSchema,
  ReviewQueueParamsSchema,
  ReviewQueueResponseSchema,
  UNCLASSIFIED_TAXONOMY_OR_PREDICATE,
} from '@/lib/validation/schemas';
import type { ReviewQueueItem, ReviewQueueResponse } from '@/types/review';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

// ID-131 {131.19} G-GOV-FACET: content_items is dying. Each content_items
// row was already 1:1 with its backing source_document (via the old
// content_items.source_document_id FK), so `id` here is now the
// source_documents id directly. Classification/content columns
// (suggested_title, summary, primary_domain, primary_subtopic,
// secondary_domain, secondary_subtopic, content_type, captured_date,
// ai_keywords, classification_confidence, publication_status) live on
// source_documents (M3). Governance/freshness columns (verified_at,
// verified_by, freshness, governance_review_status, next_review_date,
// review_cadence_days) live on the record_lifecycle facet (owner_kind=
// 'source_document', joined via the FK — record_lifecycle has NO
// source_document_id-alone UNIQUE constraint, so the embed types as an
// array; there is at most one owner_kind='source_document' row per source
// document by the facet's exactly-one-of + composite-unique design).
//
// KNOWN OUT-OF-SCOPE DEGRADATIONS (documented, not fixed here — the fields
// below have NO typed-record home post-refactor; TECH.md BI-11 drops
// platform/author_name/source_domain/priority/user_tags/brief/detail/
// reference with no replacement; quality_score/citation_count/metadata never
// gained one either; thumbnail_url moved to reference_items only, D4):
//   - `title` has no direct source_documents column — derived from
//     suggested_title ?? filename (matches the hybrid_search convention).
//   - `platform`, `author_name`, `source_domain`, `thumbnail_url`, `priority`
//     always null; `user_tags` always []; `metadata` always null.
//   - `quality_score` always null (no facet/SD column — see the {131.19}
//     quality-score cron journal for the fuller finding).
//   - `content` now reads `source_documents.extracted_text` (a real,
//     semantically-matching SD column) rather than the dead content_items
//     literal `content` column.
//   - the `quality_score_asc` sort option is a no-op (falls back to the
//     default `created_at` order) — there is no column left to sort by.
//   - `source_file` filtering is a documented no-op — content_items.source_file
//     was dropped at M3 (BI-11) with no source_documents replacement.
//
// KNOWN BUNDLE-WIDE CAVEAT: the record_lifecycle facet (M1a) shipped with
// NO backfill (additive, zero-row migration) — every `!inner` join in this
// bundle (this file included) will return zero rows for any source_document
// created before a facet-row backfill lands. This matches the pattern
// already used by the shipped {131.12}/{131.13}/{131.14} SQL functions
// (recalculate_all_freshness, get_review_breakdown_stats,
// get_dashboard_attention_counts, …), which JOIN record_lifecycle the same
// way — the backfill is out of this Subtask's scope (no migrations here).
interface SourceDocumentReviewRow {
  id: string;
  filename: string;
  suggested_title: string | null;
  summary: string | null;
  primary_domain: string;
  primary_subtopic: string;
  secondary_domain: string | null;
  secondary_subtopic: string | null;
  content_type: string | null;
  captured_date: string | null;
  ai_keywords: string[] | null;
  classification_confidence: number | null;
  source_url: string | null;
  publication_status: string;
  updated_at: string | null;
  extracted_text: string | null;
  record_lifecycle: Array<{
    verified_at: string | null;
    verified_by: string | null;
    freshness: string | null;
    governance_review_status: string | null;
    next_review_date: string | null;
    review_cadence_days: number | null;
  }>;
}

/** Columns needed by mapToReviewQueueItem — excludes large/unused fields */
const REVIEW_COLUMNS =
  'id, filename, suggested_title, summary, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, content_type, captured_date, ai_keywords, classification_confidence, source_url, publication_status, updated_at, extracted_text, record_lifecycle!inner(verified_at, verified_by, freshness, governance_review_status, next_review_date, review_cadence_days)';

export const GET = defineRoute(
  ReviewQueueResponseSchema,
  async (request: NextRequest) => {
    try {
      // Auth + role check — editors and admins only
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      // Rate limit: 20 requests per minute
      const { allowed } = checkRateLimit(`review-queue:${user.id}`, 20, 60_000);
      if (!allowed) return rateLimitResponse();

      const { searchParams } = request.nextUrl;

      // -----------------------------------------------------------------
      // Publication-review branch (§5.2-P4B / review-page-tabs-refactor-spec
      // §8 (f)). When `?publication_status=in_review` is present, the route
      // pivots to a publication_status='in_review' filter and BYPASSES the
      // verified_at + governance_review_status filters that drive the
      // standard verified-content-review queue. Per spec §6.7 line 1196 the
      // publication-review tab is orthogonal to governance state.
      //
      // The branch sits BEFORE the standard params validation because the
      // standard `ReviewQueueParamsSchema` validates `status` (one of
      // unverified|verified|flagged|draft|all) which doesn't apply here —
      // the publication-review tab is a separate query shape.
      // -----------------------------------------------------------------
      const publicationStatusParam = searchParams.get('publication_status');
      if (publicationStatusParam === 'in_review') {
        return await handlePublicationReviewQuery(supabase, searchParams);
      }

      const validated = parseSearchParams(
        ReviewQueueParamsSchema,
        searchParams,
      );
      if (!validated.success) return validated.response;

      const { status, limit, offset, sort } = validated.data;
      // Use getAll for repeated params (domain=a&domain=b) and fall back to
      // comma-separated single values (domain=a,b) for backwards compatibility.
      const domainParams = searchParams
        .getAll('domain')
        .flatMap((v) => v.split(','))
        .filter(Boolean);
      const contentTypeParams = searchParams
        .getAll('content_type')
        .flatMap((v) => v.split(','))
        .filter(Boolean);
      // source_file has no source_documents equivalent (BI-11 drop) — the
      // request param is intentionally not read; documented no-op (see file
      // header).
      const sourceDocumentIdParam = searchParams.get('source_document_id');
      const assignedToMe = searchParams.get('assigned_to_me') === 'true';
      // S205 WP-E T2 plan §T2 (H-1): mirror the assigned_to_me string-compare
      // pattern. Treat only the literal 'true' as on; '?include_overdue=false'
      // and missing param both resolve to off. `z.coerce.boolean()` is unsafe
      // here because it returns true for any non-empty string including
      // the literal 'false'.
      const includeOverdue = searchParams.get('include_overdue') === 'true';
      // ID-63.12: narrow the queue to the taxonomy 'unclassified' sentinel rows
      // ({63.11}) so the /review "Unclassified" tab has a populated queue. Raw
      // string compare mirrors include_overdue / assigned_to_me — only the
      // literal 'true' is on.
      const unclassifiedOnly = searchParams.get('unclassified') === 'true';

      // If assigned_to_me is active, look up the user's active assignments and
      // merge their filter criteria (domains, content_types) into the query.
      // Multiple assignments are unioned: items matching ANY assignment are shown.
      let assignmentDomains: string[] = [];
      let assignmentContentTypes: string[] = [];
      let hasAssignments = false;

      if (assignedToMe) {
        const { data: assignments, error: assignErr } = await supabase
          .from('review_assignments')
          .select('filter_domains, filter_content_types')
          .eq('reviewer_id', user.id)
          .eq('status', 'active');

        if (assignErr) {
          logger.error(
            { err: assignErr },
            'Failed to fetch assignments for filter',
          );
          return NextResponse.json(
            { error: 'Failed to fetch assignment filters' },
            { status: 500 },
          );
        }

        if (assignments && assignments.length > 0) {
          hasAssignments = true;
          // Union all assignment filters (items matching ANY assignment)
          for (const a of assignments) {
            if (Array.isArray(a.filter_domains)) {
              assignmentDomains.push(...a.filter_domains);
            }
            if (Array.isArray(a.filter_content_types)) {
              assignmentContentTypes.push(...a.filter_content_types);
            }
          }
          assignmentDomains = [...new Set(assignmentDomains)];
          assignmentContentTypes = [...new Set(assignmentContentTypes)];
        }

        // If user has no active assignments, return empty result immediately
        if (!hasAssignments) {
          const response: ReviewQueueResponse = {
            items: [],
            total: 0,
            verified_count: 0,
            flagged_count: 0,
            has_more: false,
          };
          return NextResponse.json(response);
        }
      }

      // Compute effective domain/content-type filters, merging assignment filters
      // with any explicit user-selected filters. This is needed for both the
      // standard and flagged query paths.
      let effectiveDomainParams = domainParams;
      let effectiveContentTypeParams = contentTypeParams;

      if (assignedToMe && assignmentDomains.length > 0) {
        effectiveDomainParams =
          domainParams.length > 0
            ? domainParams.filter((d) => assignmentDomains.includes(d))
            : assignmentDomains;
        if (effectiveDomainParams.length === 0) {
          // Intersection is empty — no results can match
          return NextResponse.json({
            items: [],
            total: 0,
            verified_count: 0,
            flagged_count: 0,
            has_more: false,
          } satisfies ReviewQueueResponse);
        }
      }

      if (assignedToMe && assignmentContentTypes.length > 0) {
        effectiveContentTypeParams =
          contentTypeParams.length > 0
            ? contentTypeParams.filter((ct) =>
                assignmentContentTypes.includes(ct),
              )
            : assignmentContentTypes;
        if (effectiveContentTypeParams.length === 0) {
          return NextResponse.json({
            items: [],
            total: 0,
            verified_count: 0,
            flagged_count: 0,
            has_more: false,
          } satisfies ReviewQueueResponse);
        }
      }

      // For flagged status, we need to find items with open review_needed flags.
      // This requires a two-step query: first find flagged IDs, then fetch items.
      if (status === 'flagged') {
        return await handleFlaggedQuery(
          supabase,
          limit,
          offset,
          effectiveDomainParams,
          effectiveContentTypeParams,
          sourceDocumentIdParam,
          sort,
        );
      }

      // Standard query for unverified/verified/draft/all statuses
      let query = supabase
        .from('source_documents')
        .select(REVIEW_COLUMNS, { count: 'exact' });

      // Draft filter: show only drafts. All other filters exclude drafts.
      // S202 §5.2 Phase 2.5 (T8b) — read from publication_status (NOT NULL
      // post-S201) instead of legacy governance_review_status. The legacy
      // column will be NULLed by Phase 1f migration; SELECT clause keeps it
      // for response-shape continuity until then.
      if (status === 'draft') {
        query = query.eq('publication_status', 'draft');
      } else {
        query = query.neq('publication_status', 'draft');
      }

      // Apply verification status filter
      //
      // S205 WP-E T2 plan §T2 (H-2): when status='unverified' AND
      // include_overdue=true, broaden the verified_at predicate so that
      // verified-but-overdue rows surface alongside unverified rows. A row
      // can have `verified_at IS NOT NULL` and still be in
      // `governance_review_status = 'review_overdue'` once its review cadence
      // elapses; without this widening the toggle would silently exclude
      // exactly the rows it advertises. For status='verified' or 'all',
      // include_overdue is a no-op super-set (verified-overdue rows already
      // pass the verified filter; 'all' has no verification filter).
      //
      // ID-131 {131.19}: verified_at/governance_review_status live on the
      // record_lifecycle facet — filtered via the embedded-resource dot
      // notation (mirrors the `application_types.key` pattern already used
      // across this codebase, e.g. app/api/procurement/route.ts).
      if (status === 'unverified') {
        if (includeOverdue) {
          query = query.or(
            'record_lifecycle.verified_at.is.null,record_lifecycle.governance_review_status.eq.review_overdue',
          );
        } else {
          query = query.is('record_lifecycle.verified_at', null);
        }
      } else if (status === 'verified') {
        query = query.not('record_lifecycle.verified_at', 'is', null);
      }
      // status === 'all' or 'draft' — no verification filter

      // Apply optional filters (using effective params that already account for
      // assignment filter intersection when assigned_to_me is active)
      if (effectiveDomainParams.length > 0) {
        query = query.in('primary_domain', effectiveDomainParams);
      }

      if (effectiveContentTypeParams.length > 0) {
        query = query.in('content_type', effectiveContentTypeParams);
      }

      // source_file: documented no-op (see file header) — content_items.
      // source_file was dropped at M3 with no source_documents replacement.

      if (sourceDocumentIdParam) {
        query = query.eq('id', sourceDocumentIdParam);
      }

      // ID-63.12: when the "Unclassified" tab is active, narrow to the
      // 'unclassified' taxonomy sentinel rows ({63.11}) so the tab lists the
      // out-of-taxonomy content that needs reclassification.
      if (unclassifiedOnly) {
        query = query.or(UNCLASSIFIED_TAXONOMY_OR_PREDICATE);
      }

      // Apply sort order. `quality_score_asc` has no column left to sort by
      // (ID-131 {131.19} — quality_score has no typed-record home) and falls
      // back to the default order.
      if (sort === 'confidence_asc') {
        query = query.order('classification_confidence', {
          ascending: true,
          nullsFirst: true,
        });
      } else {
        query = query.order('created_at', { ascending: false });
      }
      // Tiebreaker for stable ordering when sort column values are equal or null
      query = query.order('id', { ascending: true });
      // Offset-based pagination
      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        logger.error({ err: error }, 'Review queue query error');
        return NextResponse.json(
          { error: 'Failed to fetch review queue' },
          { status: 500 },
        );
      }

      const items = (data ?? []) as unknown as SourceDocumentReviewRow[];

      // Fetch verified and flagged counts in parallel for the progress bar.
      // ingestion_quality_log is now keyed by source_document_id (ID-131
      // {131.13} G-GOV-FACET-B rename; content_items is dying).
      const [verifiedResult, flaggedResult] = await Promise.all([
        countVerified(supabase),
        supabase
          .from('ingestion_quality_log')
          .select('source_document_id', { count: 'exact', head: true })
          .eq('flag_type', 'review_needed')
          .eq('resolved', false),
      ]);

      // Batch-fetch latest verification_history action per source document for
      // "last reviewed" display. verification_history is source_document_id-keyed
      // (ID-131 {131.29}) — items with no backing source document are excluded
      // and simply show no last-reviewed date.
      const mappedItems = items.map(mapToReviewQueueItem);
      const sourceDocumentIds = mappedItems
        .map((i) => i.source_document_id)
        .filter((id): id is string => Boolean(id));
      const { dates: reviewDates, warning: reviewDatesWarning } =
        await fetchLastReviewedDates(supabase, sourceDocumentIds);
      for (const item of mappedItems) {
        item.last_reviewed_at = item.source_document_id
          ? (reviewDates.get(item.source_document_id) ?? null)
          : null;
      }

      const warnings: string[] = [];
      if (reviewDatesWarning) warnings.push(reviewDatesWarning);

      const response: ReviewQueueResponse & { warnings?: string[] } = {
        items: mappedItems,
        total: count ?? 0,
        verified_count: verifiedResult.count ?? 0,
        flagged_count: flaggedResult.count ?? 0,
        has_more:
          items.length === limit && (count ?? 0) > offset + items.length,
      };
      if (warnings.length > 0) response.warnings = warnings;

      return NextResponse.json(response);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch review queue') },
        { status: 500 },
      );
    }
  },
);

/**
 * Count verified source_documents (owner_kind='source_document', facet
 * verified_at IS NOT NULL) for the review-queue progress bar. Factored out
 * because both the standard GET path and handleFlaggedQuery need the same
 * unfiltered total.
 */
async function countVerified(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
) {
  return supabase
    .from('record_lifecycle')
    .select('source_document_id', { count: 'exact', head: true })
    .eq('owner_kind', 'source_document')
    .not('verified_at', 'is', null);
}

/**
 * Handle the flagged status query separately because it requires joining
 * with ingestion_quality_log to find items with open review_needed flags.
 */
async function handleFlaggedQuery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  limit: number,
  offset: number,
  effectiveDomainParams: string[],
  effectiveContentTypeParams: string[],
  sourceDocumentIdParam: string | null,
  sort?: string,
) {
  // First, get the source_document_ids that have open review_needed flags.
  // ingestion_quality_log is now keyed by source_document_id (ID-131 {131.13}
  // G-GOV-FACET-B rename; content_items.id no longer applies), and — ID-131
  // {131.19} — that id now resolves directly against source_documents.id.
  const { data: flaggedIds, error: flagError } = await supabase
    .from('ingestion_quality_log')
    .select('source_document_id')
    .eq('flag_type', 'review_needed')
    .eq('resolved', false)
    .not('source_document_id', 'is', null);

  if (flagError) {
    logger.error({ err: flagError }, 'Failed to fetch flagged items');
    return NextResponse.json(
      { error: 'Failed to fetch flagged items' },
      { status: 500 },
    );
  }

  const sourceDocumentIds = [
    ...new Set(
      (flaggedIds ?? []).map(
        (r: { source_document_id: string }) => r.source_document_id,
      ),
    ),
  ];

  if (sourceDocumentIds.length === 0) {
    const response: ReviewQueueResponse = {
      items: [],
      total: 0,
      verified_count: 0,
      flagged_count: 0,
      has_more: false,
    };
    return NextResponse.json(response);
  }

  // Now query source_documents filtered to those ids.
  let query = supabase
    .from('source_documents')
    .select(REVIEW_COLUMNS, { count: 'exact' })
    .in('id', sourceDocumentIds);

  if (effectiveDomainParams.length > 0) {
    query = query.in('primary_domain', effectiveDomainParams);
  }

  if (effectiveContentTypeParams.length > 0) {
    query = query.in('content_type', effectiveContentTypeParams);
  }

  if (sourceDocumentIdParam) {
    query = query.eq('id', sourceDocumentIdParam);
  }

  // Apply sort order (quality_score_asc is a documented no-op — see file header)
  if (sort === 'confidence_asc') {
    query = query.order('classification_confidence', {
      ascending: true,
      nullsFirst: true,
    });
  } else {
    query = query.order('created_at', { ascending: false });
  }
  // Tiebreaker for stable ordering
  query = query.order('id', { ascending: true });
  // Offset-based pagination
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    logger.error({ err: error }, 'Flagged items query error');
    return NextResponse.json(
      { error: 'Failed to fetch flagged items' },
      { status: 500 },
    );
  }

  const items = (data ?? []) as unknown as SourceDocumentReviewRow[];

  // Fetch verified and flagged counts for the progress bar
  const [verifiedResult, flaggedResult] = await Promise.all([
    countVerified(supabase),
    supabase
      .from('ingestion_quality_log')
      .select('source_document_id', { count: 'exact', head: true })
      .eq('flag_type', 'review_needed')
      .eq('resolved', false),
  ]);

  // Batch-fetch latest verification_history action per source document for
  // "last reviewed" display. verification_history is source_document_id-keyed
  // (ID-131 {131.29}) — items with no backing source document are excluded
  // and simply show no last-reviewed date.
  const mappedItems = items.map(mapToReviewQueueItem);
  const flaggedSourceDocumentIds = mappedItems
    .map((i) => i.source_document_id)
    .filter((id): id is string => Boolean(id));
  const { dates: reviewDates, warning: reviewDatesWarning } =
    await fetchLastReviewedDates(supabase, flaggedSourceDocumentIds);
  for (const item of mappedItems) {
    item.last_reviewed_at = item.source_document_id
      ? (reviewDates.get(item.source_document_id) ?? null)
      : null;
  }

  const warnings: string[] = [];
  if (reviewDatesWarning) warnings.push(reviewDatesWarning);

  const response: ReviewQueueResponse & { warnings?: string[] } = {
    items: mappedItems,
    total: count ?? 0,
    verified_count: verifiedResult.count ?? 0,
    flagged_count: flaggedResult.count ?? 0,
    has_more: items.length === limit && (count ?? 0) > offset + items.length,
  };
  if (warnings.length > 0) response.warnings = warnings;

  return NextResponse.json(response);
}

/**
 * Handle the publication_status='in_review' query (tab 6 of /review).
 *
 * Bypasses the verified_at + governance filters that gate the standard
 * verified-content-review queue. Filters on
 * `publication_status='in_review'` only, with optional domain/content_type/
 * source_document_id orthogonal slicers and offset pagination (default 20,
 * max 100). Returns the shared `ReviewQueueResponse` shape so the new
 * `PublicationReviewQueue` component can render rows with the same
 * `mapToReviewQueueItem` mapper as the rest of the queue.
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §8 (f), §6.7 line 1196.
 */
async function handlePublicationReviewQuery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  searchParams: URLSearchParams,
) {
  // V_W1 Finding 5 fix — schema-driven param validation via
  // PublicationReviewQueueParamsSchema. The standard ReviewQueueParamsSchema
  // doesn't apply (its `status` field defaults to 'unverified' and the
  // publication-review branch is orthogonal to that axis per spec §6.7
  // line 1196). Zod's default strip mode drops the orthogonal filter keys
  // (domain, content_type, source_document_id) which are handled separately
  // below to preserve the standard branch's repeated-key + comma-list
  // parsing.
  const validated = parseSearchParams(
    PublicationReviewQueueParamsSchema,
    searchParams,
  );
  if (!validated.success) return validated.response;
  const { limit, offset } = validated.data;

  const domainParams = searchParams
    .getAll('domain')
    .flatMap((v) => v.split(','))
    .filter(Boolean);
  const contentTypeParams = searchParams
    .getAll('content_type')
    .flatMap((v) => v.split(','))
    .filter(Boolean);
  const sourceDocumentIdParam = searchParams.get('source_document_id');

  // ID-131 {131.19}: publication_status/updated_at live on source_documents
  // directly (M3 + BI-20 inline hot) — this branch needs no facet join
  // (matches the original route's use of updated_at for "most recent
  // first" ordering, which is why record_lifecycle!inner is dropped here in
  // favour of a plain source_documents select — the facet columns
  // (verified_at/governance_review_status) this tab intentionally bypasses
  // are still populated via mapToReviewQueueItem's optional-chaining
  // fallback to null when no embed is present).
  let query = supabase
    .from('source_documents')
    .select(
      'id, filename, suggested_title, summary, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, content_type, captured_date, ai_keywords, classification_confidence, source_url, publication_status, updated_at, extracted_text',
      { count: 'exact' },
    )
    .eq('publication_status', 'in_review');

  if (domainParams.length > 0) {
    query = query.in('primary_domain', domainParams);
  }
  if (contentTypeParams.length > 0) {
    query = query.in('content_type', contentTypeParams);
  }
  if (sourceDocumentIdParam) {
    query = query.eq('id', sourceDocumentIdParam);
  }

  // Most recent first — newest in_review items surface first so admins
  // approve fresh ingest output before older queued items.
  query = query.order('updated_at', { ascending: false, nullsFirst: false });
  query = query.order('id', { ascending: true });
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    logger.error({ err: error }, 'Publication-review queue query error');
    return NextResponse.json(
      { error: 'Failed to fetch publication-review queue' },
      { status: 500 },
    );
  }

  const items = (data ?? []) as unknown as Array<
    Omit<SourceDocumentReviewRow, 'record_lifecycle'>
  >;

  // Match the shape of the standard queue response so the same UI layer
  // can render. verified_count + flagged_count are not load-bearing for
  // tab 6 (the tab is orthogonal to verification state) but we surface
  // them as 0 to keep the response shape stable.
  const mappedItems = items.map((row) =>
    mapToReviewQueueItem({ ...row, record_lifecycle: [] }),
  );
  // verification_history is source_document_id-keyed (ID-131 {131.29}) — items
  // with no backing source document are excluded and simply show no
  // last-reviewed date.
  const sourceDocumentIds = mappedItems
    .map((i) => i.source_document_id)
    .filter((id): id is string => Boolean(id));
  const { dates: reviewDates, warning: reviewDatesWarning } =
    await fetchLastReviewedDates(supabase, sourceDocumentIds);
  for (const item of mappedItems) {
    item.last_reviewed_at = item.source_document_id
      ? (reviewDates.get(item.source_document_id) ?? null)
      : null;
  }

  const warnings: string[] = [];
  if (reviewDatesWarning) warnings.push(reviewDatesWarning);

  const response: ReviewQueueResponse & { warnings?: string[] } = {
    items: mappedItems,
    total: count ?? 0,
    verified_count: 0,
    flagged_count: 0,
    has_more: items.length === limit && (count ?? 0) > offset + items.length,
  };
  if (warnings.length > 0) response.warnings = warnings;

  return NextResponse.json(response);
}

/**
 * Batch-fetch the most recent verification_history performed_at per source
 * document. Returns a Map of source_document_id → ISO timestamp string.
 *
 * verification_history is keyed by source_document_id, not content_items.id,
 * since ID-131 {131.29}'s re-parent (verification moves with governance,
 * PRODUCT BI-10). Callers must pass resolved source_document_id values, not
 * content_items.id — items with no backing source document are excluded
 * upstream and simply show no last-reviewed date.
 */
async function fetchLastReviewedDates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sourceDocumentIds: string[],
): Promise<{ dates: Map<string, string>; warning?: string }> {
  const result = new Map<string, string>();
  if (sourceDocumentIds.length === 0) return { dates: result };

  const { data, error } = await supabase
    .from('verification_history')
    .select('source_document_id, performed_at')
    .in('source_document_id', sourceDocumentIds)
    .order('performed_at', { ascending: false });

  if (error) {
    logger.error({ err: error }, 'Failed to fetch verification_history dates');
    return {
      dates: result,
      warning:
        'Last-reviewed dates could not be loaded; items may show as never reviewed.',
    };
  }

  if (data) {
    // Take the first (most recent) entry per source document
    for (const row of data as Array<{
      source_document_id: string;
      performed_at: string;
    }>) {
      if (!result.has(row.source_document_id)) {
        result.set(row.source_document_id, row.performed_at);
      }
    }
  }

  return { dates: result };
}

/**
 * Map a raw source_documents(+record_lifecycle) row to a ReviewQueueItem,
 * ensuring consistent shape. ID-131 {131.19}: content_items is dying — see
 * the file header for the full column-provenance + degradation notes.
 */
function mapToReviewQueueItem(row: SourceDocumentReviewRow): ReviewQueueItem {
  const facet = row.record_lifecycle[0];
  return {
    id: row.id,
    source_document_id: row.id,
    title: row.suggested_title ?? row.filename,
    suggested_title: row.suggested_title,
    summary: row.summary,
    primary_domain: row.primary_domain,
    primary_subtopic: row.primary_subtopic,
    // source_documents.content_type is nullable (post-{131.9} DROP NOT
    // NULL — a classification output unknown at ingest); ContentListItem's
    // content_type is non-null (inherited from the dying content_items
    // schema) — 'other' mirrors the COALESCE(sd.content_type, 'other')
    // convention already used by get_review_breakdown_stats' by_content_type.
    content_type: row.content_type ?? 'other',
    // Dead columns — no typed-record home post-refactor (see file header).
    platform: null,
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: row.captured_date,
    ai_keywords: Array.isArray(row.ai_keywords) ? row.ai_keywords : [],
    classification_confidence: row.classification_confidence,
    priority: null,
    user_tags: [],
    metadata: null,
    content: row.extracted_text ?? null,
    source_url: row.source_url ?? null,
    verified_at: facet?.verified_at ?? null,
    verified_by: facet?.verified_by ?? null,
    secondary_domain: row.secondary_domain ?? null,
    secondary_subtopic: row.secondary_subtopic ?? null,
    freshness: facet?.freshness ?? null,
    governance_review_status: facet?.governance_review_status ?? null,
    next_review_date: facet?.next_review_date ?? null,
    review_cadence_days: facet?.review_cadence_days ?? null,
    quality_score: null,
    publication_status:
      (row.publication_status as ReviewQueueItem['publication_status']) ?? null,
    last_reviewed_at: null, // Populated post-query from verification_history
  };
}
