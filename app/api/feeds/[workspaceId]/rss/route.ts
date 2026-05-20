import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { parseSearchParams } from '@/lib/validation';
import { generateRss, toRfc2822 } from '@/lib/intelligence/rss-generator';
import { clientEnv } from '@/lib/env-client';
import { logger } from '@/lib/logger';

type RouteContext = { params: Promise<{ workspaceId: string }> };

const feedSearchSchema = z.object({
  limit: z.number().min(1).max(100).default(50),
});

/**
 * GET /api/feeds/:workspaceId/rss — Public RSS 2.0 feed of passed articles.
 *
 * No authentication required. Returns XML with Content-Type application/rss+xml.
 * Designed for intranet embedding and standard feed readers.
 *
 * Query params:
 *   - limit: number (default 50, max 100) — number of items
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { workspaceId } = await context.params;
    const supabase = createServiceClient();

    const parsed = parseSearchParams(
      feedSearchSchema,
      request.nextUrl.searchParams,
    );
    const limit = parsed.success ? parsed.data.limit : 50;

    // Fetch workspace for channel metadata.
    // Post-T2: discriminator via application_types JOIN.
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('id, name, description, application_types!inner(key)')
      .eq('id', workspaceId)
      .eq('application_types.key', 'intelligence')
      .single();

    if (wsError || !workspace) {
      return new NextResponse('Feed not found', { status: 404 });
    }

    // Fetch passed articles with source names
    const { data: articles, error: articlesError } = await supabase
      .from('feed_articles')
      .select(
        'id, title, external_url, ai_summary, relevance_reasoning, relevance_score, matched_categories, published_at, ingested_at, feed_sources(name)',
      )
      .eq('workspace_id', workspaceId)
      .eq('passed', true)
      .order('ingested_at', { ascending: false })
      .limit(limit);

    if (articlesError) {
      // Do not return an empty 200 RSS document on DB error — feed readers
      // will not retry and the user will silently lose updates.
      logger.error(
        { err: articlesError, workspaceId },
        'RSS feed: failed to fetch articles for workspace',
      );
      return new NextResponse('Failed to load feed articles', { status: 500 });
    }

    // Build RSS
    const baseUrl = clientEnv.NEXT_PUBLIC_APP_URL;

    const channel = {
      title: `${workspace.name} — Intelligence Feed`,
      link: `${baseUrl}/intelligence/${workspaceId}`,
      description:
        workspace.description ??
        `Sector intelligence feed for ${workspace.name}`,
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
    logger.error({ err }, 'RSS feed: unexpected error');
    return new NextResponse('Internal server error', { status: 500 });
  }
}
