/**
 * Contract tests for MCP App data shapes.
 *
 * These verify that the data shapes produced by server-side MCP trigger tools
 * (formatters.ts) are structurally compatible with the client-side MCP App
 * type definitions. If the server changes its output shape and breaks the
 * contract, these tests will fail.
 *
 * We create sample data objects that must satisfy BOTH the server interface
 * (from formatters.ts) and the client interface (reimplemented here to avoid
 * importing DOM-dependent app code).
 */
import { describe, it, expect } from 'vitest';
import type {
  IntelligenceArticle as ServerIntelligenceArticle,
  IntelligenceSummaryData as ServerIntelligenceSummaryData,
} from '@/lib/mcp/formatters/intelligence';

// ---------------------------------------------------------------------------
// Client-side type mirrors (from mcp-apps/*/src/types.ts)
// We redefine them here so tests don't depend on DOM / ext-apps SDK imports.
// ---------------------------------------------------------------------------

interface ClientCoverageMatrixData {
  total_items: number;
  freshness: {
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
  };
  domains: Array<{
    name: string;
    total_items: number;
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
    subtopics: Array<{
      name: string;
      total_items: number;
      fresh: number;
      aging: number;
      stale: number;
      expired: number;
    }>;
  }>;
  quality: {
    total_flagged: number;
    by_issue_type: Record<string, number>;
  };
  gaps: Array<{
    domain: string;
    subtopic: string | null;
    item_count: number;
    issue: 'empty' | 'thin' | 'stale_only';
  }>;
}

interface ClientBidSummary {
  id: string;
  name: string;
  buyer: string | null;
  status: string;
  deadline: string | null;
  days_until_deadline: number | null;
  total_questions: number;
  answered_questions: number;
  approved_questions: number;
}

interface ClientBidDashboardData {
  offset: number;
  count: number;
  total_count: number;
  has_more: boolean;
  procurements: ClientBidSummary[];
  focused_form_detail?: ClientBidDetailData;
}

interface ClientBidQuestionSummary {
  id: string;
  question_text: string;
  status: string;
  confidence_posture: string | null;
  word_limit: number | null;
  has_response: boolean;
  review_status: string | null;
}

interface ClientBidSection {
  name: string;
  questions: ClientBidQuestionSummary[];
}

interface ClientBidDetailData {
  id: string;
  name: string;
  buyer: string | null;
  status: string;
  deadline: string | null;
  reference_number: string | null;
  description: string | null;
  question_stats: {
    total_questions: number;
    strong_match_count: number;
    partial_match_count: number;
    needs_sme_count: number;
    no_content_count: number;
    unmatched_count: number;
    drafted_count: number;
    complete_count: number;
  } | null;
  sections: ClientBidSection[];
  status_breakdown: Record<string, number>;
  confidence_breakdown: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Intelligence Feed client-side type mirrors
// ---------------------------------------------------------------------------

interface ClientIntelligenceArticle {
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

interface ClientIntelligenceSummaryData {
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
  top_articles: ClientIntelligenceArticle[];
  unresolved_flags: number;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIntelligenceSummaryData(): ServerIntelligenceSummaryData &
  ClientIntelligenceSummaryData {
  return {
    workspace_id: 'ws-001',
    workspace_name: 'UK Construction Intelligence',
    period: '7d',
    period_label: 'Last 7 days',
    total_ingested: 42,
    total_passed: 18,
    total_filtered: 24,
    filter_ratio: 0.571,
    by_category: { 'Market Trends': 8, 'Competitor Activity': 5, Policy: 5 },
    by_source: [
      { source_name: 'Construction News', article_count: 15, passed_count: 8 },
      { source_name: 'GOV.UK', article_count: 10, passed_count: 4 },
    ],
    top_articles: [
      {
        id: 'art-001',
        title: 'New procurement framework announced',
        source_name: 'GOV.UK',
        external_url: 'https://www.gov.uk/example',
        relevance_score: 0.92,
        relevance_category: 'high',
        ai_summary: 'The government has announced a new procurement framework.',
        matched_categories: ['Policy', 'Market Trends'],
        published_at: '2026-03-30T10:00:00Z',
        ingested_at: '2026-03-30T12:00:00Z',
      },
      {
        id: 'art-002',
        title: 'Competitor wins major contract',
        source_name: 'Construction News',
        external_url: 'https://example.com/news/123',
        relevance_score: 0.65,
        relevance_category: 'medium',
        ai_summary: null,
        matched_categories: ['Competitor Activity'],
        published_at: null,
        ingested_at: '2026-03-29T08:00:00Z',
      },
    ],
    unresolved_flags: 2,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP App contract: IntelligenceSummaryData', () => {
  it('server shape satisfies client interface', () => {
    const data = makeIntelligenceSummaryData();
    expect(data.workspace_id).toBe('ws-001');
    expect(data.workspace_name).toBe('UK Construction Intelligence');
    expect(data.period).toBe('7d');
    expect(data.period_label).toBe('Last 7 days');
    expect(typeof data.total_ingested).toBe('number');
    expect(typeof data.total_passed).toBe('number');
    expect(typeof data.total_filtered).toBe('number');
    expect(typeof data.filter_ratio).toBe('number');
    expect(typeof data.unresolved_flags).toBe('number');
  });

  it('by_category is a string-to-number record', () => {
    const data = makeIntelligenceSummaryData();
    expect(data.by_category).toHaveProperty('Market Trends');
    expect(typeof data.by_category['Market Trends']).toBe('number');
  });

  it('by_source entries include all required fields', () => {
    const data = makeIntelligenceSummaryData();
    expect(data.by_source).toBeInstanceOf(Array);
    const source = data.by_source[0];
    expect(source).toHaveProperty('source_name');
    expect(source).toHaveProperty('article_count');
    expect(source).toHaveProperty('passed_count');
  });

  it('article includes all required fields', () => {
    const data = makeIntelligenceSummaryData();
    const article = data.top_articles[0];
    expect(article).toHaveProperty('id');
    expect(article).toHaveProperty('title');
    expect(article).toHaveProperty('source_name');
    expect(article).toHaveProperty('external_url');
    expect(article).toHaveProperty('relevance_score');
    expect(article).toHaveProperty('relevance_category');
    expect(article).toHaveProperty('ai_summary');
    expect(article).toHaveProperty('matched_categories');
    expect(article).toHaveProperty('published_at');
    expect(article).toHaveProperty('ingested_at');
  });

  it('article ai_summary and published_at can be null', () => {
    const data = makeIntelligenceSummaryData();
    const nullArticle = data.top_articles.find((a) => a.ai_summary === null);
    expect(nullArticle).toBeDefined();
    expect(nullArticle!.published_at).toBeNull();
  });

  it('relevance_category accepts all valid values', () => {
    const data = makeIntelligenceSummaryData();
    expect(data.top_articles[0].relevance_category).toBe('high');
    expect(data.top_articles[1].relevance_category).toBe('medium');

    const lowArticle: ServerIntelligenceArticle & ClientIntelligenceArticle = {
      ...data.top_articles[0],
      relevance_category: 'low',
    };
    expect(lowArticle.relevance_category).toBe('low');

    const irrelevantArticle: ServerIntelligenceArticle &
      ClientIntelligenceArticle = {
      ...data.top_articles[0],
      relevance_category: 'irrelevant',
    };
    expect(irrelevantArticle.relevance_category).toBe('irrelevant');
  });

  it('handles empty top_articles array', () => {
    const data: ServerIntelligenceSummaryData & ClientIntelligenceSummaryData =
      {
        workspace_id: 'ws-empty',
        workspace_name: 'Empty Workspace',
        period: '7d',
        period_label: 'Last 7 days',
        total_ingested: 0,
        total_passed: 0,
        total_filtered: 0,
        filter_ratio: 0,
        by_category: {},
        by_source: [],
        top_articles: [],
        unresolved_flags: 0,
      };
    expect(data.top_articles).toHaveLength(0);
    expect(data.total_ingested).toBe(0);
  });

  it('matched_categories can be empty array', () => {
    const article: ServerIntelligenceArticle & ClientIntelligenceArticle = {
      id: 'art-empty-cats',
      title: 'No categories',
      source_name: 'Test',
      external_url: 'https://example.com',
      relevance_score: 0.5,
      relevance_category: 'medium',
      ai_summary: null,
      matched_categories: [],
      published_at: null,
      ingested_at: '2026-04-01T00:00:00Z',
    };
    expect(article.matched_categories).toHaveLength(0);
  });
});
