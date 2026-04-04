/**
 * Client-side type definitions for the Intelligence Feed MCP App.
 *
 * These MUST exactly mirror the server-side interfaces in
 * lib/mcp/formatters/intelligence.ts. Verified by contract tests
 * in __tests__/mcp/mcp-app-contracts.test.ts.
 */

export interface IntelligenceArticle {
  id: string;
  title: string;
  source_name: string;
  external_url: string;
  relevance_score: number;
  relevance_category: 'high' | 'medium' | 'low' | 'irrelevant';
  ai_summary: string | null;
  matched_categories: string[];
  published_at: string | null;
  ingested_at: string;
}

export interface IntelligenceSummaryData {
  workspace_id: string;
  workspace_name: string;
  period: string;
  period_label: string;
  total_ingested: number;
  total_passed: number;
  total_filtered: number;
  filter_ratio: number;
  by_category: Record<string, number>;
  by_source: Array<{
    source_name: string;
    article_count: number;
    passed_count: number;
  }>;
  top_articles: IntelligenceArticle[];
  unresolved_flags: number;
}
