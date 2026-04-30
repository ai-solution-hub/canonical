import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { parseSearchParams } from '@/lib/validation';
import { generateRss, toRfc2822 } from '@/lib/intelligence/rss-generator';
import { clientEnv } from '@/lib/env-client';
import { logger } from '@/lib/logger';

type RouteContext = { params: Promise<{ workspaceId: string }> };

const filteredFeedSearchSchema = z.object({
  limit: z.number().min(1).max(100).default(20),
});

/**
 * GET /api/feeds/:workspaceId/rss/filtered — Public RSS 2.0 feed of filtered (near-miss) articles.
 *
 * No authentication required. Returns XML with Content-Type application/rss+xml.
 * Shows articles that scored close to the threshold but did not pass —
 * useful for reviewing potential false negatives without logging in.
 *
 * Query params:
 *   - limit: number (default 20, max 100) — number of items
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { workspaceId } = await context.params;
    const supabase = createServiceClient();

    const parsed = parseSearchParams(
      filteredFeedSearchSchema,
      request.nextUrl.searchParams,
    );
    const limit = parsed.success ? parsed.data.limit : 20;

    // Fetch workspace for channel metadata
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('id, name, description, type')
      .eq('id', workspaceId)
      .eq('type', 'intelligence')
      .single();

    if (wsError || !workspace) {
      return new NextResponse('Feed not found', { status: 404 });
    }

    // Fetch filtered (near-miss) articles — highest-scoring rejects first
    const { data: articles, error: articlesError } = await supabase
      .from('feed_articles')
      .select(
        'id, title, external_url, ai_summary, relevance_reasoning, relevance_score, matched_categories, published_at, ingested_at, feed_sources(name)',
      )
      .eq('workspace_id', workspaceId)
      .eq('passed', false)
      .order('relevance_score', { ascending: false })
      .limit(limit);

    if (articlesError) {
      logger.error(
        { err: articlesError, workspaceId },
        'Filtered RSS feed: failed to fetch articles for workspace',
      );
      return new NextResponse('Failed to load feed articles', { status: 500 });
    }

    // Build RSS
    const baseUrl = clientEnv.NEXT_PUBLIC_APP_URL;

    const channel = {
      title: `${workspace.name} — Filtered Articles (Near Misses)`,
      link: `${baseUrl}/intelligence/${workspaceId}`,
      description:
        'Articles that scored close to the threshold but did not pass. Review for potential false negatives.',
      language: 'en-GB',
      lastBuildDate: toRfc2822(new Date().toISOString()),
      ttl: 15,
    };

    const items = (articles ?? []).map((a) => ({
      title: a.title,
      link: a.external_url,
      description: a.ai_summary ?? a.relevance_reasoning ?? '',
      pubDate: a.published_at ?? a.ingested_at,
      categories: a.matched_categories ?? [],
      guid: a.id,
      source: (a.feed_sources as { name: string } | null)?.name,
      relevanceScore: a.relevance_score ?? undefined,
    }));

    const xml = generateRss(channel, items);

    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=900, s-maxage=900',
      },
    });
  } catch (err) {
    logger.error({ err }, 'Filtered RSS feed: unexpected error');
    return new NextResponse('Internal server error', { status: 500 });
  }
}
