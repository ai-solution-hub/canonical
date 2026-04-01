// app/api/intelligence/workspaces/[id]/metrics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

type RouteContext = { params: Promise<{ id: string }> };

const VALID_PERIODS = ['7d', '30d', 'all'] as const;
type Period = (typeof VALID_PERIODS)[number];

function getPeriodInterval(period: Period): string | null {
  switch (period) {
    case '7d':
      return '7 days';
    case '30d':
      return '30 days';
    case 'all':
      return null;
  }
}

/** GET /api/intelligence/workspaces/:id/metrics — aggregate workspace metrics */
export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const periodParam = request.nextUrl.searchParams.get('period') ?? '30d';
    const period = VALID_PERIODS.includes(periodParam as Period)
      ? (periodParam as Period)
      : '30d';

    const intervalDays = getPeriodInterval(period);

    // Build date filter
    let dateFilter: string | null = null;
    if (intervalDays) {
      const d = new Date();
      const days = parseInt(intervalDays);
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
    const { data: lastArticle } = await supabase
      .from('feed_articles')
      .select('ingested_at')
      .eq('workspace_id', id)
      .order('ingested_at', { ascending: false })
      .limit(1)
      .single();

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
      period,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch metrics') },
      { status: 500 },
    );
  }
}
