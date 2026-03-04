import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse, rateLimitResponse } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { ReviewQueueParamsSchema } from '@/lib/validation/schemas';
import type { ReviewQueueResponse, ReviewQueueItem } from '@/types/review';
import type { Database } from '@/supabase/types/database.types';

type ContentItemRow = Database['public']['Tables']['content_items']['Row'];

/**
 * GET /api/review/queue — fetch content items for the review workflow.
 *
 * Supports filtering by verification status (unverified/verified/flagged/all),
 * domain, content type, and source file. Returns cursor-based pagination.
 */
export async function GET(request: NextRequest) {
  try {
    // Auth + role check — editors and admins only
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    // Rate limit: 20 requests per minute
    const { allowed } = checkRateLimit(`review-queue:${user.id}`, 20, 60_000);
    if (!allowed) return rateLimitResponse();

    const { searchParams } = request.nextUrl;
    const validated = parseSearchParams(ReviewQueueParamsSchema, searchParams);
    if (!validated.success) return validated.response;

    const { status, limit, cursor } = validated.data;
    // Use getAll for repeated params (domain=a&domain=b) and fall back to
    // comma-separated single values (domain=a,b) for backwards compatibility.
    const domainParams = searchParams.getAll('domain').flatMap(v => v.split(',')).filter(Boolean);
    const contentTypeParams = searchParams.getAll('content_type').flatMap(v => v.split(',')).filter(Boolean);
    const sourceFileParam = searchParams.get('source_file');

    // For flagged status, we need to find items with open review_needed flags.
    // This requires a two-step query: first find flagged IDs, then fetch items.
    if (status === 'flagged') {
      return await handleFlaggedQuery(
        supabase, limit, cursor,
        domainParams, contentTypeParams, sourceFileParam,
      );
    }

    // Standard query for unverified/verified/all statuses
    let query = supabase
      .from('content_items')
      .select('*', { count: 'exact' });

    // Apply verification status filter
    if (status === 'unverified') {
      query = query.is('verified_at', null);
    } else if (status === 'verified') {
      query = query.not('verified_at', 'is', null);
    }
    // status === 'all' — no verification filter

    // Apply optional filters
    if (domainParams.length > 0) {
      query = query.in('primary_domain', domainParams);
    }

    if (contentTypeParams.length > 0) {
      query = query.in('content_type', contentTypeParams);
    }

    if (sourceFileParam) {
      // Filter by metadata->source_file using the JSONB text accessor
      query = query.eq('metadata->>source_file' as string, sourceFileParam);
    }

    // Cursor-based pagination using created_at
    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    // Sort by creation date descending (newest first)
    query = query.order('created_at', { ascending: false }).limit(limit);

    const { data, error, count } = await query;

    if (error) {
      console.error('Review queue query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch review queue' },
        { status: 500 },
      );
    }

    const items = (data ?? []) as ContentItemRow[];
    const lastItem = items.length > 0 ? items[items.length - 1] : null;

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

    const response: ReviewQueueResponse = {
      items: items.map(mapToReviewQueueItem),
      total: count ?? 0,
      verified_count: verifiedResult.count ?? 0,
      flagged_count: flaggedResult.count ?? 0,
      cursor: lastItem?.created_at ?? undefined,
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
  cursor: string | undefined,
  domainParams: string[],
  contentTypeParams: string[],
  sourceFileParam: string | null,
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

  const itemIds = [...new Set(
    (flaggedIds ?? []).map((r: { content_item_id: string }) => r.content_item_id),
  )];

  if (itemIds.length === 0) {
    const response: ReviewQueueResponse = {
      items: [],
      total: 0,
      verified_count: 0,
      flagged_count: 0,
    };
    return NextResponse.json(response);
  }

  // Now query content_items filtered to those IDs
  let query = supabase
    .from('content_items')
    .select('*', { count: 'exact' })
    .in('id', itemIds);

  if (domainParams.length > 0) {
    query = query.in('primary_domain', domainParams);
  }

  if (contentTypeParams.length > 0) {
    query = query.in('content_type', contentTypeParams);
  }

  if (sourceFileParam) {
    query = query.eq('metadata->>source_file', sourceFileParam);
  }

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  query = query.order('created_at', { ascending: false }).limit(limit);

  const { data, error, count } = await query;

  if (error) {
    console.error('Flagged items query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch flagged items' },
      { status: 500 },
    );
  }

  const items = (data ?? []) as ContentItemRow[];
  const lastItem = items.length > 0 ? items[items.length - 1] : null;

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

  const response: ReviewQueueResponse = {
    items: items.map(mapToReviewQueueItem),
    total: count ?? 0,
    verified_count: verifiedResult.count ?? 0,
    flagged_count: flaggedResult.count ?? 0,
    cursor: lastItem?.created_at ?? undefined,
  };

  return NextResponse.json(response);
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
  };
}
