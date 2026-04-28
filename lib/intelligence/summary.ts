/**
 * Intelligence summary data fetcher.
 *
 * Aggregates feed article, source, and flag data for a workspace over a
 * configurable time period. Used by the get_intelligence_summary MCP tool.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IntelligenceSummaryData,
  IntelligenceArticle,
} from '@/lib/mcp/formatters/intelligence';

// ---------------------------------------------------------------------------
// Period map
// ---------------------------------------------------------------------------

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
};

const PERIOD_LABELS: Record<string, string> = {
  '7d': 'Last 7 days',
  '14d': 'Last 14 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

export async function fetchIntelligenceSummary(
  supabase: SupabaseClient,
  workspaceId: string,
  period: string = '7d',
  articleLimit: number = 10,
): Promise<IntelligenceSummaryData> {
  // 1. Verify workspace exists and is intelligence type
  const { data: workspace, error: wsError } = await supabase
    .from('workspaces')
    .select('id, name, type')
    .eq('id', workspaceId)
    .single();

  if (wsError || !workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  if (workspace.type !== 'intelligence') {
    throw new Error(
      `Workspace "${workspace.name}" is type "${workspace.type}", not "intelligence". Only intelligence workspaces have feed data.`,
    );
  }

  // 2. Compute period cutoff
  const days = PERIOD_DAYS[period] ?? 7;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString();

  // 3. Fetch articles and sources in parallel
  const [articlesResult, sourcesResult, flagsResult] = await Promise.all([
    supabase
      .from('feed_articles')
      .select(
        'id, title, external_url, feed_source_id, relevance_score, relevance_category, ai_summary, matched_categories, published_at, ingested_at, passed',
      )
      .eq('workspace_id', workspaceId)
      .gte('ingested_at', cutoffISO)
      .order('relevance_score', { ascending: false }),
    supabase
      .from('feed_sources')
      .select('id, name')
      .eq('workspace_id', workspaceId),
    supabase
      .from('feed_flags')
      .select('id, feed_article_id')
      .eq('resolved', false),
  ]);

  const articles = (articlesResult.data ?? []) as Array<{
    id: string;
    title: string;
    external_url: string;
    feed_source_id: string;
    relevance_score: number | null;
    relevance_category: string | null;
    ai_summary: string | null;
    matched_categories: string[] | null;
    published_at: string | null;
    ingested_at: string;
    passed: boolean;
  }>;

  // Build source name lookup
  const sourceNameMap = new Map<string, string>();
  for (const source of (sourcesResult.data ?? []) as Array<{
    id: string;
    name: string;
  }>) {
    sourceNameMap.set(source.id, source.name);
  }

  // Get article IDs for this workspace to filter flags
  const articleIds = new Set(articles.map((a) => a.id));

  // Count unresolved flags for articles in this workspace
  const unresolvedFlags = (
    (flagsResult.data ?? []) as Array<{
      id: string;
      feed_article_id: string;
    }>
  ).filter((f) => articleIds.has(f.feed_article_id)).length;

  // 4. Aggregate totals
  const totalIngested = articles.length;
  const totalPassed = articles.filter((a) => a.passed).length;
  const totalFiltered = totalIngested - totalPassed;
  const filterRatio = totalIngested > 0 ? totalFiltered / totalIngested : 0;

  // 5. Aggregate by_category from matched_categories
  const byCategory: Record<string, number> = {};
  for (const article of articles) {
    if (article.matched_categories) {
      for (const cat of article.matched_categories) {
        byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      }
    }
  }

  // 6. Aggregate by_source
  const sourceStats = new Map<
    string,
    { source_name: string; article_count: number; passed_count: number }
  >();
  for (const article of articles) {
    const sourceName =
      sourceNameMap.get(article.feed_source_id) ?? 'Unknown Source';
    const existing = sourceStats.get(article.feed_source_id);
    if (existing) {
      existing.article_count += 1;
      if (article.passed) existing.passed_count += 1;
    } else {
      sourceStats.set(article.feed_source_id, {
        source_name: sourceName,
        article_count: 1,
        passed_count: article.passed ? 1 : 0,
      });
    }
  }
  const bySource = Array.from(sourceStats.values()).sort(
    (a, b) => b.article_count - a.article_count,
  );

  // 7. Build top_articles from passed articles
  const passedArticles = articles.filter((a) => a.passed);
  const topArticles: IntelligenceArticle[] = passedArticles
    .slice(0, articleLimit)
    .map((a) => ({
      id: a.id,
      title: a.title,
      source_name: sourceNameMap.get(a.feed_source_id) ?? 'Unknown Source',
      external_url: a.external_url,
      relevance_score: a.relevance_score ?? 0,
      relevance_category: (a.relevance_category ?? 'low') as
        | 'high'
        | 'medium'
        | 'low'
        | 'irrelevant',
      ai_summary: a.ai_summary,
      matched_categories: a.matched_categories ?? [],
      published_at: a.published_at,
      ingested_at: a.ingested_at,
    }));

  return {
    workspace_id: workspaceId,
    workspace_name: workspace.name,
    period,
    period_label: PERIOD_LABELS[period] ?? `Last ${days} days`,
    total_ingested: totalIngested,
    total_passed: totalPassed,
    total_filtered: totalFiltered,
    filter_ratio: filterRatio,
    by_category: byCategory,
    by_source: bySource,
    top_articles: topArticles,
    unresolved_flags: unresolvedFlags,
  };
}
