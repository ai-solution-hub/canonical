/**
 * Intelligence summary formatters for MCP tool responses.
 *
 * Formats sector intelligence workspace data as Markdown for human
 * consumption, with structured data interfaces for machine consumers.
 */
import { formatDateUK } from '@/lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

function relevanceBadge(score: number): string {
  if (score >= 0.8) return `[HIGH ${Math.round(score * 100)}%]`;
  if (score >= 0.5) return `[MED ${Math.round(score * 100)}%]`;
  return `[LOW ${Math.round(score * 100)}%]`;
}

export function formatIntelligenceSummary(
  data: IntelligenceSummaryData,
): string {
  const lines: string[] = [
    `# Intelligence Summary: ${data.workspace_name}`,
    '',
    `**Period:** ${data.period_label}`,
    '',
    '## Overview',
    '',
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Total ingested | ${data.total_ingested} |`,
    `| Passed filter | ${data.total_passed} |`,
    `| Filtered out | ${data.total_filtered} |`,
    `| Filter ratio | ${Math.round(data.filter_ratio * 100)}% |`,
    `| Unresolved flags | ${data.unresolved_flags} |`,
  ];

  // Category breakdown
  const categoryEntries = Object.entries(data.by_category);
  if (categoryEntries.length > 0) {
    lines.push(
      '',
      '## By Category',
      '',
      '| Category | Count |',
      '| --- | --- |',
    );
    for (const [category, count] of categoryEntries) {
      lines.push(`| ${category} | ${count} |`);
    }
  }

  // Source breakdown
  if (data.by_source.length > 0) {
    lines.push(
      '',
      '## By Source',
      '',
      '| Source | Articles | Passed |',
      '| --- | --- | --- |',
    );
    for (const source of data.by_source) {
      lines.push(
        `| ${source.source_name} | ${source.article_count} | ${source.passed_count} |`,
      );
    }
  }

  // Top articles
  if (data.top_articles.length > 0) {
    lines.push('', '## Top Articles', '');
    for (const article of data.top_articles) {
      const dateStr = article.published_at
        ? formatDateUK(article.published_at)
        : formatDateUK(article.ingested_at);
      lines.push(
        `### ${article.title}`,
        '',
        `${relevanceBadge(article.relevance_score)} | **${article.source_name}** | ${dateStr}`,
      );
      if (article.ai_summary) {
        lines.push('', article.ai_summary);
      }
      if (article.matched_categories.length > 0) {
        lines.push(
          '',
          `**Categories:** ${article.matched_categories.join(', ')}`,
        );
      }
      lines.push('', `[Read more](${article.external_url})`, '');
    }
  } else {
    lines.push('', '_No articles passed the relevance filter in this period._');
  }

  return lines.join('\n');
}
