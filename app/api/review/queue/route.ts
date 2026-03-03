import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { ReviewQueueParamsSchema } from '@/lib/validation/schemas';
import {
  parseJsonbArray,
  ReviewQueueRowSchema,
} from '@/lib/validation/jsonb';
import type { ReviewQueueResponse, ReviewQueueItem } from '@/types/review';

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { searchParams } = request.nextUrl;
    const validated = parseSearchParams(ReviewQueueParamsSchema, searchParams);
    if (!validated.success) return validated.response;

    const { limit, cursor } = validated.data;
    const domainParam = searchParams.get('domain');
    const contentTypeParam = searchParams.get('content_type');
    const platformParam = searchParams.get('platform');

    // Single RPC call replaces 3 sequential queries (read marks + items + count)
    const { data, error } = await supabase.rpc('get_review_queue', {
      p_domains: domainParam
        ? domainParam.split(',').filter(Boolean)
        : undefined,
      p_content_types: contentTypeParam
        ? contentTypeParam.split(',').filter(Boolean)
        : undefined,
      p_platforms: platformParam
        ? platformParam.split(',').filter(Boolean)
        : undefined,
      p_cursor: cursor || undefined,
      p_limit: limit,
    });

    if (error) {
      console.error('Review queue RPC error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch review queue' },
        { status: 500 },
      );
    }

    const row = data?.[0];
    const items = parseJsonbArray(ReviewQueueRowSchema, row?.items ?? []).map(
      (item) => ({
        ...item,
        // Ensure ai_keywords is always an array (JSONB aggregation may return it as-is)
        ai_keywords: Array.isArray(item.ai_keywords) ? item.ai_keywords : [],
      }),
    ) as ReviewQueueItem[];
    const total = Number(row?.total_count ?? 0);
    const lastItem = items.length > 0 ? items[items.length - 1] : null;

    const response: ReviewQueueResponse = {
      items,
      total,
      cursor: lastItem?.captured_date ?? undefined,
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch review queue') },
      { status: 500 },
    );
  }
}
