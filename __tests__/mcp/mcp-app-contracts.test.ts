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
  CoverageMatrixData as ServerCoverageMatrixData,
  ProcurementDashboardData as ServerBidDashboardData,
  ProcurementDetail as ServerBidDetail,
} from '@/lib/mcp/formatters';
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
  bids: ClientBidSummary[];
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
// Fixtures
// ---------------------------------------------------------------------------

function makeCoverageMatrixData(): ServerCoverageMatrixData &
  ClientCoverageMatrixData {
  return {
    total_items: 186,
    freshness: { fresh: 120, aging: 40, stale: 20, expired: 6 },
    domains: [
      {
        name: 'Security',
        total_items: 45,
        fresh: 30,
        aging: 10,
        stale: 3,
        expired: 2,
        subtopics: [
          {
            name: 'Penetration Testing',
            total_items: 12,
            fresh: 8,
            aging: 3,
            stale: 1,
            expired: 0,
          },
          {
            name: 'Incident Response',
            total_items: 8,
            fresh: 5,
            aging: 2,
            stale: 1,
            expired: 0,
          },
        ],
      },
    ],
    quality: {
      total_flagged: 3,
      by_issue_type: { thin_content: 2, missing_summary: 1 },
    },
    gaps: [
      {
        domain: 'Security',
        subtopic: 'Zero Trust',
        item_count: 0,
        issue: 'empty' as const,
      },
      {
        domain: 'Operations',
        subtopic: null,
        item_count: 2,
        issue: 'thin' as const,
      },
    ],
  };
}

function makeBidDashboardData(): ServerBidDashboardData &
  ClientBidDashboardData {
  return {
    offset: 0,
    count: 2,
    total_count: 2,
    has_more: false,
    bids: [
      {
        id: 'bid-001',
        name: 'NHS Digital Transformation',
        buyer: 'NHS England',
        status: 'active',
        deadline: '2026-04-15',
        days_until_deadline: 37,
        total_questions: 25,
        answered_questions: 18,
        approved_questions: 12,
      },
      {
        id: 'bid-002',
        name: 'MoD Cyber Security',
        buyer: null,
        status: 'drafting',
        deadline: '2026-03-01',
        days_until_deadline: -8,
        total_questions: 40,
        answered_questions: 10,
        approved_questions: 5,
      },
    ],
  };
}

function makeBidDetail(): ServerBidDetail & ClientBidDetailData {
  return {
    id: 'bid-001',
    name: 'NHS Digital Transformation',
    buyer: 'NHS England',
    status: 'active',
    deadline: '2026-04-15',
    reference_number: 'NHS-DT-2026-001',
    description: 'Digital transformation framework for NHS trusts.',
    question_stats: {
      total_questions: 25,
      strong_match_count: 10,
      partial_match_count: 8,
      needs_sme_count: 3,
      no_content_count: 2,
      unmatched_count: 2,
      drafted_count: 15,
      complete_count: 10,
    },
    sections: [
      {
        name: 'Organisation',
        questions: [
          {
            id: 'q1',
            question_text: 'Describe your organisation',
            status: 'complete',
            confidence_posture: 'strong_match',
            word_limit: 500,
            has_response: true,
            review_status: 'approved',
          },
        ],
      },
    ],
    status_breakdown: { complete: 10, ai_drafted: 5, not_started: 10 },
    confidence_breakdown: {
      strong_match: 10,
      partial_match: 8,
      needs_sme: 3,
      no_content: 2,
      unmatched: 2,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP App contract: CoverageMatrixData', () => {
  it('server shape satisfies client interface', () => {
    const data = makeCoverageMatrixData();
    // If this compiles and the object has the right keys, the contract holds
    expect(data.total_items).toBe(186);
    expect(data.freshness).toHaveProperty('fresh');
    expect(data.freshness).toHaveProperty('aging');
    expect(data.freshness).toHaveProperty('stale');
    expect(data.freshness).toHaveProperty('expired');
    expect(data.domains).toBeInstanceOf(Array);
    expect(data.quality).toHaveProperty('total_flagged');
    expect(data.quality).toHaveProperty('by_issue_type');
    expect(data.gaps).toBeInstanceOf(Array);
  });

  it('domain objects include subtopics array', () => {
    const data = makeCoverageMatrixData();
    const domain = data.domains[0];
    expect(domain.name).toBe('Security');
    expect(domain.subtopics).toBeInstanceOf(Array);
    expect(domain.subtopics[0]).toHaveProperty('name');
    expect(domain.subtopics[0]).toHaveProperty('total_items');
    expect(domain.subtopics[0]).toHaveProperty('fresh');
  });

  it('gap issue field accepts all three valid values', () => {
    const data = makeCoverageMatrixData();
    // Existing values
    const issues = data.gaps.map((g) => g.issue);
    expect(issues).toContain('empty');
    expect(issues).toContain('thin');

    // Add stale_only and verify the union type accepts it
    data.gaps.push({
      domain: 'Test',
      subtopic: 'Sub',
      item_count: 5,
      issue: 'stale_only',
    });
    expect(data.gaps[data.gaps.length - 1].issue).toBe('stale_only');
  });

  it('handles empty domains array', () => {
    const data: ServerCoverageMatrixData & ClientCoverageMatrixData = {
      total_items: 0,
      freshness: { fresh: 0, aging: 0, stale: 0, expired: 0 },
      domains: [],
      quality: { total_flagged: 0, by_issue_type: {} },
      gaps: [],
    };
    expect(data.domains).toHaveLength(0);
    expect(data.gaps).toHaveLength(0);
  });

  it('handles domain with empty subtopics', () => {
    const data = makeCoverageMatrixData();
    data.domains.push({
      name: 'Empty Domain',
      total_items: 0,
      fresh: 0,
      aging: 0,
      stale: 0,
      expired: 0,
      subtopics: [],
    });
    const emptyDomain = data.domains[data.domains.length - 1];
    expect(emptyDomain.subtopics).toHaveLength(0);
    expect(emptyDomain.total_items).toBe(0);
  });

  it('gap subtopic can be null (domain-level gap)', () => {
    const data = makeCoverageMatrixData();
    const domainGap = data.gaps.find((g) => g.subtopic === null);
    expect(domainGap).toBeDefined();
    expect(domainGap!.domain).toBe('Operations');
  });
});

describe('MCP App contract: ProcurementDashboardData', () => {
  it('server shape satisfies client interface', () => {
    const data = makeBidDashboardData();
    expect(data.offset).toBe(0);
    expect(data.count).toBe(2);
    expect(data.total_count).toBe(2);
    expect(data.has_more).toBe(false);
    expect(data.bids).toBeInstanceOf(Array);
    expect(data.bids).toHaveLength(2);
  });

  it('bid summary includes all required fields', () => {
    const data = makeBidDashboardData();
    const bid = data.bids[0];
    expect(bid).toHaveProperty('id');
    expect(bid).toHaveProperty('name');
    expect(bid).toHaveProperty('buyer');
    expect(bid).toHaveProperty('status');
    expect(bid).toHaveProperty('deadline');
    expect(bid).toHaveProperty('days_until_deadline');
    expect(bid).toHaveProperty('total_questions');
    expect(bid).toHaveProperty('answered_questions');
    expect(bid).toHaveProperty('approved_questions');
  });

  it('buyer can be null', () => {
    const data = makeBidDashboardData();
    const nullBuyer = data.bids.find((b) => b.buyer === null);
    expect(nullBuyer).toBeDefined();
    expect(nullBuyer!.name).toBe('MoD Cyber Security');
  });

  it('days_until_deadline can be negative (overdue)', () => {
    const data = makeBidDashboardData();
    const overdue = data.bids.find((b) => (b.days_until_deadline ?? 0) < 0);
    expect(overdue).toBeDefined();
    expect(overdue!.days_until_deadline).toBe(-8);
  });

  it('handles empty bids array', () => {
    const data: ServerBidDashboardData & ClientBidDashboardData = {
      offset: 0,
      count: 0,
      total_count: 0,
      has_more: false,
      bids: [],
    };
    expect(data.bids).toHaveLength(0);
    expect(data.total_count).toBe(0);
  });

  it('focused_form_detail is optional', () => {
    const data = makeBidDashboardData();
    expect(data.focused_form_detail).toBeUndefined();
  });

  it('focused_form_detail can be set with full detail', () => {
    const data = makeBidDashboardData();
    const detail = makeBidDetail();
    // The server type uses Record<string, unknown>, the client uses ProcurementDetailData.
    // The client app casts it: data.focused_form_detail as unknown as ProcurementDetailData
    // So assigning a full ProcurementDetailData must be valid through the Record type.
    (data as ServerBidDashboardData).focused_form_detail =
      detail as unknown as Record<string, unknown>;
    expect((data as ServerBidDashboardData).focused_form_detail).toBeDefined();

    // Verify the detail can be read back with client-expected fields
    const readBack = (data as ServerBidDashboardData)
      .focused_form_detail as unknown as ClientBidDetailData;
    expect(readBack.id).toBe('bid-001');
    expect(readBack.question_stats).toBeDefined();
    expect(readBack.question_stats!.total_questions).toBe(25);
  });
});

describe('MCP App contract: ProcurementDetail / ProcurementDetailData', () => {
  it('server ProcurementDetail satisfies client ProcurementDetailData', () => {
    const detail = makeBidDetail();
    expect(detail.id).toBe('bid-001');
    expect(detail.name).toBe('NHS Digital Transformation');
    expect(detail.buyer).toBe('NHS England');
    expect(detail.status).toBe('active');
    expect(detail.reference_number).toBe('NHS-DT-2026-001');
    expect(detail.description).toBeTruthy();
    expect(detail.question_stats).not.toBeNull();
  });

  it('question_stats can be null', () => {
    const detail: ServerBidDetail & ClientBidDetailData = {
      id: 'bid-002',
      name: 'Draft Procurement',
      buyer: null,
      status: 'draft',
      deadline: null,
      reference_number: null,
      description: null,
      question_stats: null,
      sections: [],
      status_breakdown: {},
      confidence_breakdown: {},
    };
    expect(detail.question_stats).toBeNull();
    expect(detail.buyer).toBeNull();
    expect(detail.deadline).toBeNull();
  });

  it('question_stats includes all required breakdown fields', () => {
    const detail = makeBidDetail();
    const qs = detail.question_stats!;
    expect(qs).toHaveProperty('total_questions');
    expect(qs).toHaveProperty('strong_match_count');
    expect(qs).toHaveProperty('partial_match_count');
    expect(qs).toHaveProperty('needs_sme_count');
    expect(qs).toHaveProperty('no_content_count');
    expect(qs).toHaveProperty('unmatched_count');
    expect(qs).toHaveProperty('drafted_count');
    expect(qs).toHaveProperty('complete_count');
  });

  it('all nullable fields accept null', () => {
    const detail: ServerBidDetail & ClientBidDetailData = {
      id: 'bid-minimal',
      name: 'Minimal Procurement',
      buyer: null,
      status: 'draft',
      deadline: null,
      reference_number: null,
      description: null,
      question_stats: null,
      sections: [],
      status_breakdown: {},
      confidence_breakdown: {},
    };
    expect(detail.buyer).toBeNull();
    expect(detail.deadline).toBeNull();
    expect(detail.reference_number).toBeNull();
    expect(detail.description).toBeNull();
    expect(detail.question_stats).toBeNull();
  });
});

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
