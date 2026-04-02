// app/api/intelligence/workspaces/[id]/articles/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { FeedArticleListParamsSchema } from '@/lib/validation/schemas';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/intelligence/workspaces/:id/articles — list articles (passed or filtered) */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(
      FeedArticleListParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;

    const { tab, page, limit, source_id: sourceId } = parsed.data;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('feed_articles')
      .select(
        `id, title, external_url, relevance_score, relevance_category,
         relevance_reasoning, ai_summary, ingested_at, published_at,
         content_item_id, passed,
         feed_sources!inner(name),
         feed_flags(id)`,
        { count: 'exact' },
      )
      .eq('workspace_id', id)
      .eq('passed', tab === 'passed');

    if (sourceId) {
      query = query.eq('feed_source_id', sourceId);
    }

    // Passed tab: newest first. Filtered tab: highest relevance first (likely false negatives)
    if (tab === 'passed') {
      query = query.order('ingested_at', { ascending: false });
    } else {
      query = query.order('relevance_score', { ascending: false });
    }

    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch articles' },
        { status: 500 },
      );
    }

    const articles = (data ?? []).map((row: Record<string, unknown>) => {
      const feedSources = row.feed_sources as { name: string } | null;
      const feedFlags = row.feed_flags as { id: string }[] | null;
      return {
        id: row.id,
        title: row.title,
        external_url: row.external_url,
        relevance_score: row.relevance_score,
        relevance_category: row.relevance_category,
        relevance_reasoning: row.relevance_reasoning,
        ai_summary: row.ai_summary,
        ingested_at: row.ingested_at,
        published_at: row.published_at,
        content_item_id: row.content_item_id,
        passed: row.passed,
        source_name: feedSources?.name ?? null,
        flag_count: feedFlags?.length ?? 0,
      };
    });

    return NextResponse.json({
      articles,
      total: count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch articles') },
      { status: 500 },
    );
  }
}
