// app/api/intelligence/workspaces/[id]/metrics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

const MetricsParamsSchema = z.object({
  period: z.enum(['7d', '30d', 'all']).default('30d'),
});

/** GET /api/intelligence/workspaces/:id/metrics — aggregate workspace metrics */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const parsed = parseSearchParams(
      MetricsParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { period } = parsed.data;

    // Build date filter
    let dateFilter: string | null = null;
    if (period !== 'all') {
      const days = period === '7d' ? 7 : 30;
      const d = new Date();
      d.setDate(d.getDate() - days);
      dateFilter = d.toISOString();
    }

    // Article counts
    let totalQuery = supabase
      .from('feed_articles')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', id);
    if (dateFilter) totalQuery = totalQuery.gte('ingested_at', dateFilter);
    const { count: totalArticles } = await totalQuery;

    let passedQuery = supabase
      .from('feed_articles')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', id)
      .eq('passed', true);
    if (dateFilter) passedQuery = passedQuery.gte('ingested_at', dateFilter);
    const { count: passedArticles } = await passedQuery;

    const total = totalArticles ?? 0;
    const passed = passedArticles ?? 0;
    const filtered = total - passed;

    // Flag counts — MUST JOIN via feed_articles since feed_flags has no workspace_id
    // We fetch feed_articles for this workspace, then count flags via the join
    let flagQuery = supabase
      .from('feed_flags')
      .select('id, flag_type, resolved, feed_articles!inner(workspace_id)', {
        count: 'exact',
      })
      .eq('feed_articles.workspace_id', id);
    if (dateFilter) flagQuery = flagQuery.gte('created_at', dateFilter);
    const { data: flagData, count: totalFlags } = await flagQuery;

    const flags = flagData ?? [];
    const falsePositiveFlags = flags.filter(
      (f: Record<string, unknown>) => f.flag_type === 'false_positive',
    ).length;
    const falseNegativeFlags = flags.filter(
      (f: Record<string, unknown>) => f.flag_type === 'false_negative',
    ).length;
    const unresolvedFlags = flags.filter(
      (f: Record<string, unknown>) => f.resolved === false,
    ).length;

    // Last poll time (most recent ingested_at)
    const { data: lastArticle, error: lastArticleError } = await supabase
      .from('feed_articles')
      .select('ingested_at')
      .eq('workspace_id', id)
      .order('ingested_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastArticleError) {
      console.error(
        'Failed to fetch last poll time for workspace metrics:',
        lastArticleError,
      );
    }

    // Source health
    const { count: activeSources } = await supabase
      .from('feed_sources')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', id)
      .eq('is_active', true);

    const { count: sourcesWithErrors } = await supabase
      .from('feed_sources')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', id)
      .gt('consecutive_failures', 0);

    // Recent unresolved flags (last 5) with article title
    const { data: recentFlags, error: recentFlagsError } = await supabase
      .from('feed_flags')
      .select(
        'id, flag_type, notes, created_at, feed_articles!inner(title, workspace_id)',
      )
      .eq('feed_articles.workspace_id', id)
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(5);
    if (recentFlagsError) {
      console.error(
        'Failed to fetch recent flags for workspace metrics:',
        recentFlagsError,
      );
    }

    return NextResponse.json({
      total_articles: total,
      passed_articles: passed,
      filtered_articles: filtered,
      filter_ratio: total > 0 ? Math.round((passed / total) * 100) : 0,
      total_flags: totalFlags ?? 0,
      false_positive_flags: falsePositiveFlags,
      false_negative_flags: falseNegativeFlags,
      unresolved_flags: unresolvedFlags,
      last_poll_time: lastArticle?.ingested_at ?? null,
      active_sources: activeSources ?? 0,
      sources_with_errors: sourcesWithErrors ?? 0,
      recent_flags: (recentFlags ?? []).map((f: Record<string, unknown>) => ({
        id: f.id,
        flag_type: f.flag_type,
        notes: f.notes,
        created_at: f.created_at,
        article_title:
          (f.feed_articles as Record<string, unknown>)?.title ?? 'Unknown',
      })),
      period,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch metrics') },
      { status: 500 },
    );
  }
}
