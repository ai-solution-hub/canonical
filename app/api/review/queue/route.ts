import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { ReviewQueueParamsSchema } from '@/lib/validation/schemas';
import type { ReviewQueueResponse, ReviewQueueItem } from '@/types/review';
import type { Database } from '@/supabase/types/database.types';

export const maxDuration = 30;

type ContentItemRow = Database['public']['Tables']['content_items']['Row'];

/** Columns needed by mapToReviewQueueItem — excludes embedding, summary_data, reader_html and other large/unused fields */
const REVIEW_COLUMNS =
  'id, title, suggested_title, ai_summary, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, content_type, platform, author_name, source_domain, thumbnail_url, captured_date, ai_keywords, classification_confidence, quality_score, priority, user_tags, metadata, content, source_url, verified_at, verified_by, freshness, governance_review_status, created_at';

/**
 * GET /api/review/queue — fetch content items for the review workflow.
 *
 * Supports filtering by verification status (unverified/verified/flagged/all),
 * domain, content type, and source file. Returns offset-based pagination.
 */
export async function GET(request: NextRequest) {
  try {
    // Auth + role check — editors and admins only
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // Rate limit: 20 requests per minute
    const { allowed } = checkRateLimit(`review-queue:${user.id}`, 20, 60_000);
    if (!allowed) return rateLimitResponse();

    const { searchParams } = request.nextUrl;
    const validated = parseSearchParams(ReviewQueueParamsSchema, searchParams);
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
    const sourceFileParam = searchParams.get('source_file');
    const sourceDocumentIdParam = searchParams.get('source_document_id');

    // For flagged status, we need to find items with open review_needed flags.
    // This requires a two-step query: first find flagged IDs, then fetch items.
    if (status === 'flagged') {
      return await handleFlaggedQuery(
        supabase,
        limit,
        offset,
        domainParams,
        contentTypeParams,
        sourceFileParam,
        sourceDocumentIdParam,
        sort,
      );
    }

    // Standard query for unverified/verified/draft/all statuses
    let query = supabase
      .from('content_items')
      .select(REVIEW_COLUMNS, { count: 'exact' });

    // Draft filter: show only drafts. All other filters exclude drafts.
    if (status === 'draft') {
      query = query.eq('governance_review_status', 'draft');
    } else {
      query = query.or(
        'governance_review_status.is.null,governance_review_status.neq.draft',
      );
    }

    // Apply verification status filter
    if (status === 'unverified') {
      query = query.is('verified_at', null);
    } else if (status === 'verified') {
      query = query.not('verified_at', 'is', null);
    }
    // status === 'all' or 'draft' — no verification filter

    // Apply optional filters
    if (domainParams.length > 0) {
      query = query.in('primary_domain', domainParams);
    }

    if (contentTypeParams.length > 0) {
      query = query.in('content_type', contentTypeParams);
    }

    if (sourceFileParam) {
      query = query.eq('source_file', sourceFileParam);
    }

    if (sourceDocumentIdParam) {
      query = query.eq('source_document_id', sourceDocumentIdParam);
    }

    // Apply sort order
    if (sort === 'confidence_asc') {
      query = query.order('classification_confidence', {
        ascending: true,
        nullsFirst: true,
      });
    } else if (sort === 'quality_score_asc') {
      query = query.order('quality_score', {
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
      console.error('Review queue query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch review queue' },
        { status: 500 },
      );
    }

    const items = (data ?? []) as ContentItemRow[];

    // Fetch verified and flagged counts in parallel for the progress bar
    const [verifiedResult, flaggedResult] = await Promise.all([
      supabase
        .from('content_items')
        .select('id', { count: 'exact', head: true })
        .not('verified_at', 'is', null),
      supabase
        .from('ingestion_quality_log')
        .select('content_item_id', { count: 'exact', head: true })
        .eq('flag_type', 'review_needed')
        .eq('resolved', false),
    ]);

    // Batch-fetch latest verification_history action per item for "last reviewed" display
    const mappedItems = items.map(mapToReviewQueueItem);
    const itemIds = mappedItems.map((i) => i.id);
    const reviewDates = await fetchLastReviewedDates(supabase, itemIds);
    for (const item of mappedItems) {
      item.last_reviewed_at = reviewDates.get(item.id) ?? null;
    }

    const response: ReviewQueueResponse = {
      items: mappedItems,
      total: count ?? 0,
      verified_count: verifiedResult.count ?? 0,
      flagged_count: flaggedResult.count ?? 0,
      has_more: items.length === limit && (count ?? 0) > offset + items.length,
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch review queue') },
      { status: 500 },
    );
  }
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
  domainParams: string[],
  contentTypeParams: string[],
  sourceFileParam: string | null,
  sourceDocumentIdParam: string | null,
  sort?: string,
) {
  // First, get the content_item_ids that have open review_needed flags
  const { data: flaggedIds, error: flagError } = await supabase
    .from('ingestion_quality_log')
    .select('content_item_id')
    .eq('flag_type', 'review_needed')
    .eq('resolved', false)
    .not('content_item_id', 'is', null);

  if (flagError) {
    console.error('Failed to fetch flagged items:', flagError);
    return NextResponse.json(
      { error: 'Failed to fetch flagged items' },
      { status: 500 },
    );
  }

  const itemIds = [
    ...new Set(
      (flaggedIds ?? []).map(
        (r: { content_item_id: string }) => r.content_item_id,
      ),
    ),
  ];

  if (itemIds.length === 0) {
    const response: ReviewQueueResponse = {
      items: [],
      total: 0,
      verified_count: 0,
      flagged_count: 0,
      has_more: false,
    };
    return NextResponse.json(response);
  }

  // Now query content_items filtered to those IDs
  let query = supabase
    .from('content_items')
    .select(REVIEW_COLUMNS, { count: 'exact' })
    .in('id', itemIds);

  if (domainParams.length > 0) {
    query = query.in('primary_domain', domainParams);
  }

  if (contentTypeParams.length > 0) {
    query = query.in('content_type', contentTypeParams);
  }

  if (sourceFileParam) {
    query = query.eq('source_file', sourceFileParam);
  }

  if (sourceDocumentIdParam) {
    query = query.eq('source_document_id', sourceDocumentIdParam);
  }

  // Apply sort order
  if (sort === 'confidence_asc') {
    query = query.order('classification_confidence', {
      ascending: true,
      nullsFirst: true,
    });
  } else if (sort === 'quality_score_asc') {
    query = query.order('quality_score', { ascending: true, nullsFirst: true });
  } else {
    query = query.order('created_at', { ascending: false });
  }
  // Tiebreaker for stable ordering
  query = query.order('id', { ascending: true });
  // Offset-based pagination
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error('Flagged items query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch flagged items' },
      { status: 500 },
    );
  }

  const items = (data ?? []) as ContentItemRow[];

  // Fetch verified and flagged counts for the progress bar
  const [verifiedResult, flaggedResult] = await Promise.all([
    supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true })
      .not('verified_at', 'is', null),
    supabase
      .from('ingestion_quality_log')
      .select('content_item_id', { count: 'exact', head: true })
      .eq('flag_type', 'review_needed')
      .eq('resolved', false),
  ]);

  // Batch-fetch latest verification_history action per item for "last reviewed" display
  const mappedItems = items.map(mapToReviewQueueItem);
  const flaggedItemIds = mappedItems.map((i) => i.id);
  const reviewDates = await fetchLastReviewedDates(supabase, flaggedItemIds);
  for (const item of mappedItems) {
    item.last_reviewed_at = reviewDates.get(item.id) ?? null;
  }

  const response: ReviewQueueResponse = {
    items: mappedItems,
    total: count ?? 0,
    verified_count: verifiedResult.count ?? 0,
    flagged_count: flaggedResult.count ?? 0,
    has_more: items.length === limit && (count ?? 0) > offset + items.length,
  };

  return NextResponse.json(response);
}

/**
 * Batch-fetch the most recent verification_history performed_at per item.
 * Returns a Map of content_item_id → ISO timestamp string.
 */
async function fetchLastReviewedDates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  itemIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (itemIds.length === 0) return result;

  const { data } = await supabase
    .from('verification_history')
    .select('content_item_id, performed_at')
    .in('content_item_id', itemIds)
    .order('performed_at', { ascending: false });

  if (data) {
    // Take the first (most recent) entry per item
    for (const row of data as Array<{
      content_item_id: string;
      performed_at: string;
    }>) {
      if (!result.has(row.content_item_id)) {
        result.set(row.content_item_id, row.performed_at);
      }
    }
  }

  return result;
}

/**
 * Map a raw database row to a ReviewQueueItem, ensuring consistent shape.
 * Strips large fields (embedding, summary_data) not needed for review display.
 */
function mapToReviewQueueItem(row: ContentItemRow): ReviewQueueItem {
  return {
    id: row.id,
    title: row.title,
    suggested_title: row.suggested_title,
    ai_summary: row.ai_summary,
    primary_domain: row.primary_domain,
    primary_subtopic: row.primary_subtopic,
    content_type: row.content_type,
    platform: row.platform,
    author_name: row.author_name,
    source_domain: row.source_domain,
    thumbnail_url: row.thumbnail_url,
    captured_date: row.captured_date,
    ai_keywords: Array.isArray(row.ai_keywords) ? row.ai_keywords : [],
    classification_confidence: row.classification_confidence,
    priority: row.priority,
    user_tags: Array.isArray(row.user_tags) ? row.user_tags : [],
    metadata: row.metadata as Record<string, unknown> | null,
    content: row.content ?? null,
    source_url: row.source_url ?? null,
    verified_at: row.verified_at ?? null,
    verified_by: row.verified_by ?? null,
    secondary_domain: row.secondary_domain ?? null,
    secondary_subtopic: row.secondary_subtopic ?? null,
    freshness: row.freshness ?? null,
    governance_review_status: row.governance_review_status ?? null,
    quality_score: row.quality_score ?? null,
    last_reviewed_at: null, // Populated post-query from verification_history
  };
}
