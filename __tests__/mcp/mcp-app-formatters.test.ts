import { describe, it, expect } from 'vitest';
import {
  formatCoverageMatrix,
  formatBidDashboard,
  formatBidDetail,
  type CoverageMatrixData,
  type BidDashboardData,
  type BidDetail,
} from '@/lib/mcp/formatters';

// ──────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────

const sampleCoverageMatrix: CoverageMatrixData = {
  total_items: 186,
  freshness: {
    fresh: 120,
    aging: 40,
    stale: 20,
    expired: 6,
  },
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
    {
      name: 'Compliance & Governance',
      total_items: 30,
      fresh: 20,
      aging: 5,
      stale: 3,
      expired: 2,
      subtopics: [
        {
          name: 'GDPR Compliance',
          total_items: 10,
          fresh: 7,
          aging: 2,
          stale: 1,
          expired: 0,
        },
        {
          name: 'ISO Standards',
          total_items: 5,
          fresh: 3,
          aging: 1,
          stale: 1,
          expired: 0,
        },
      ],
    },
  ],
  quality: {
    total_flagged: 5,
    by_issue_type: {
      thin_content: 3,
      missing_summary: 2,
    },
  },
  gaps: [
    {
      domain: 'Security',
      subtopic: 'Zero Trust',
      item_count: 0,
      issue: 'empty',
    },
    {
      domain: 'Compliance & Governance',
      subtopic: 'SOC 2',
      item_count: 2,
      issue: 'thin',
    },
    {
      domain: 'Operations',
      subtopic: 'Supply Chain',
      item_count: 4,
      issue: 'stale_only',
    },
  ],
};

const sampleBidDashboard: BidDashboardData = {
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
      name: 'MoD Cyber Security Framework',
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

// ──────────────────────────────────────────
// formatCoverageMatrix
// ──────────────────────────────────────────

describe('formatCoverageMatrix', () => {
  it('returns Markdown with total items count', () => {
    const result = formatCoverageMatrix(sampleCoverageMatrix);

    expect(result).toContain('# Coverage Matrix');
    expect(result).toContain('**Total items:** 186');
  });

  it('includes freshness breakdown', () => {
    const result = formatCoverageMatrix(sampleCoverageMatrix);

    expect(result).toContain('## Freshness Overview');
    expect(result).toContain('**Fresh:** 120');
    expect(result).toContain('**Aging:** 40');
    expect(result).toContain('**Stale:** 20');
    expect(result).toContain('**Expired:** 6');
  });

  it('includes domain table with correct headers', () => {
    const result = formatCoverageMatrix(sampleCoverageMatrix);

    expect(result).toContain('## Domains');
    expect(result).toContain(
      '| Domain | Total | Fresh | Aging | Stale | Expired |',
    );
    expect(result).toContain('| Security | 45 | 30 | 10 | 3 | 2 |');
    expect(result).toContain(
      '| Compliance & Governance | 30 | 20 | 5 | 3 | 2 |',
    );
  });

  it('shows quality issues when flagged', () => {
    const result = formatCoverageMatrix(sampleCoverageMatrix);

    expect(result).toContain('## Quality Issues');
    expect(result).toContain('**5 items flagged**');
    expect(result).toContain('thin content: 3');
    expect(result).toContain('missing summary: 2');
  });

  it('shows coverage gaps section', () => {
    const result = formatCoverageMatrix(sampleCoverageMatrix);

    expect(result).toContain('## Coverage Gaps (3)');
    expect(result).toContain('Security > Zero Trust: 0 items');
    expect(result).toContain('Compliance & Governance > SOC 2: 2 items (thin)');
    expect(result).toContain('Operations > Supply Chain: stale only');
  });

  it('handles empty domains array', () => {
    const emptyDomains: CoverageMatrixData = {
      ...sampleCoverageMatrix,
      domains: [],
      gaps: [],
    };
    const result = formatCoverageMatrix(emptyDomains);

    expect(result).toContain('# Coverage Matrix');
    expect(result).toContain('**Total items:** 186');
    expect(result).not.toContain('## Domains');
  });

  it('handles zero total items', () => {
    const empty: CoverageMatrixData = {
      total_items: 0,
      freshness: { fresh: 0, aging: 0, stale: 0, expired: 0 },
      domains: [],
      quality: { total_flagged: 0, by_issue_type: {} },
      gaps: [],
    };
    const result = formatCoverageMatrix(empty);

    expect(result).toContain('**Total items:** 0');
    expect(result).toContain('**Fresh:** 0');
    expect(result).not.toContain('## Domains');
    expect(result).not.toContain('## Quality Issues');
    expect(result).not.toContain('## Coverage Gaps');
  });

  it('omits quality section when no items are flagged', () => {
    const noQuality: CoverageMatrixData = {
      ...sampleCoverageMatrix,
      quality: { total_flagged: 0, by_issue_type: {} },
    };
    const result = formatCoverageMatrix(noQuality);

    expect(result).not.toContain('## Quality Issues');
  });

  it('omits gaps section when no gaps exist', () => {
    const noGaps: CoverageMatrixData = {
      ...sampleCoverageMatrix,
      gaps: [],
    };
    const result = formatCoverageMatrix(noGaps);

    expect(result).not.toContain('## Coverage Gaps');
  });

  it('replaces underscores in quality issue type names', () => {
    const result = formatCoverageMatrix(sampleCoverageMatrix);

    expect(result).toContain('thin content');
    expect(result).toContain('missing summary');
    expect(result).not.toContain('thin_content');
    expect(result).not.toContain('missing_summary');
  });

  it('handles domain with no subtopics', () => {
    const domainNoSubtopics: CoverageMatrixData = {
      ...sampleCoverageMatrix,
      domains: [
        {
          name: 'Operations',
          total_items: 10,
          fresh: 5,
          aging: 3,
          stale: 1,
          expired: 1,
          subtopics: [],
        },
      ],
    };
    const result = formatCoverageMatrix(domainNoSubtopics);

    expect(result).toContain('| Operations | 10 | 5 | 3 | 1 | 1 |');
  });

  it('shows gap location without subtopic as domain only', () => {
    const domainGap: CoverageMatrixData = {
      ...sampleCoverageMatrix,
      gaps: [
        { domain: 'New Domain', subtopic: null, item_count: 0, issue: 'empty' },
      ],
    };
    const result = formatCoverageMatrix(domainGap);

    expect(result).toContain('New Domain: 0 items');
    expect(result).not.toContain('New Domain >');
  });
});

// ──────────────────────────────────────────
// formatBidDashboard
// ──────────────────────────────────────────

describe('formatBidDashboard', () => {
  it('returns Markdown with bid count', () => {
    const result = formatBidDashboard(sampleBidDashboard);

    expect(result).toContain('# Bid Dashboard');
    expect(result).toContain('**2 bids**');
  });

  it('includes bid cards with names as headings', () => {
    const result = formatBidDashboard(sampleBidDashboard);

    expect(result).toContain('## NHS Digital Transformation');
    expect(result).toContain('## MoD Cyber Security Framework');
  });

  it('shows buyer name when present', () => {
    const result = formatBidDashboard(sampleBidDashboard);

    expect(result).toContain('**Buyer:** NHS England');
  });

  it('shows "Not specified" for null buyer', () => {
    const result = formatBidDashboard(sampleBidDashboard);

    expect(result).toContain('**Buyer:** Not specified');
  });

  it('shows status for each bid', () => {
    const result = formatBidDashboard(sampleBidDashboard);

    expect(result).toContain('**Status:** active');
    expect(result).toContain('**Status:** drafting');
  });

  it('shows deadline with days remaining', () => {
    const result = formatBidDashboard(sampleBidDashboard);

    expect(result).toContain('37 days remaining');
  });

  it('shows deadline with days overdue', () => {
    const result = formatBidDashboard(sampleBidDashboard);

    expect(result).toContain('8 days overdue');
  });

  it('shows progress percentage', () => {
    const result = formatBidDashboard(sampleBidDashboard);

    // NHS: 18/25 = 72%
    expect(result).toContain('18/25 answered (72%)');
    // MoD: 10/40 = 25%
    expect(result).toContain('10/40 answered (25%)');
  });

  it('shows approved questions count', () => {
    const result = formatBidDashboard(sampleBidDashboard);

    expect(result).toContain('**Approved:** 12/25');
    expect(result).toContain('**Approved:** 5/40');
  });

  it('handles empty bids array', () => {
    const noBids: BidDashboardData = {
      offset: 0,
      count: 0,
      total_count: 0,
      has_more: false,
      bids: [],
    };
    const result = formatBidDashboard(noBids);

    expect(result).toContain('# Bid Dashboard');
    expect(result).toContain('No active bids found.');
  });

  it('handles singular bid count', () => {
    const singleBid: BidDashboardData = {
      offset: 0,
      count: 1,
      total_count: 1,
      has_more: false,
      bids: [sampleBidDashboard.bids[0]],
    };
    const result = formatBidDashboard(singleBid);

    expect(result).toContain('**1 bid**');
    expect(result).not.toContain('**1 bids**');
  });

  it('handles bid with no deadline', () => {
    const noDeadline: BidDashboardData = {
      offset: 0,
      count: 1,
      total_count: 1,
      has_more: false,
      bids: [
        {
          id: 'bid-003',
          name: 'Draft Proposal',
          buyer: 'Test Client',
          status: 'draft',
          deadline: null,
          days_until_deadline: null,
          total_questions: 10,
          answered_questions: 0,
          approved_questions: 0,
        },
      ],
    };
    const result = formatBidDashboard(noDeadline);

    expect(result).not.toContain('**Deadline:**');
  });

  it('handles bid with zero questions', () => {
    const noQuestions: BidDashboardData = {
      offset: 0,
      count: 1,
      total_count: 1,
      has_more: false,
      bids: [
        {
          id: 'bid-004',
          name: 'Empty Bid',
          buyer: null,
          status: 'draft',
          deadline: null,
          days_until_deadline: null,
          total_questions: 0,
          answered_questions: 0,
          approved_questions: 0,
        },
      ],
    };
    const result = formatBidDashboard(noQuestions);

    expect(result).toContain('0/0 answered (0%)');
  });

  it('handles deadline with null days_until_deadline', () => {
    const deadlineNoDays: BidDashboardData = {
      offset: 0,
      count: 1,
      total_count: 1,
      has_more: false,
      bids: [
        {
          id: 'bid-005',
          name: 'Deadline No Days',
          buyer: 'Client',
          status: 'active',
          deadline: '2026-06-01',
          days_until_deadline: null,
          total_questions: 5,
          answered_questions: 2,
          approved_questions: 1,
        },
      ],
    };
    const result = formatBidDashboard(deadlineNoDays);

    // Should show deadline without parenthetical days info
    expect(result).toContain('**Deadline:** 01/06/2026');
    expect(result).not.toContain('days remaining');
    expect(result).not.toContain('days overdue');
  });
});

// ──────────────────────────────────────────
// formatBidDetail (with sections and breakdowns)
// ──────────────────────────────────────────

const sampleBidDetail: BidDetail = {
  id: 'bid-001',
  name: 'NHS Digital Transformation',
  buyer: 'NHS England',
  status: 'active',
  deadline: '2026-04-15',
  reference_number: 'NHS-DT-2026',
  description: 'A digital transformation bid.',
  question_stats: {
    total_questions: 10,
    strong_match_count: 4,
    partial_match_count: 3,
    needs_sme_count: 2,
    no_content_count: 1,
    unmatched_count: 0,
    drafted_count: 6,
    complete_count: 3,
  },
  sections: [
    {
      name: 'Organisation',
      questions: [
        {
          id: 'q1',
          question_text: 'Describe your organisation structure',
          status: 'complete',
          confidence_posture: 'strong_match',
          word_limit: 500,
          has_response: true,
          review_status: 'approved',
        },
        {
          id: 'q2',
          question_text: 'How many employees do you have?',
          status: 'ai_drafted',
          confidence_posture: 'partial_match',
          word_limit: null,
          has_response: true,
          review_status: null,
        },
      ],
    },
    {
      name: 'Technical',
      questions: [
        {
          id: 'q3',
          question_text:
            'Describe your approach to information security including ISO 27001 certification and ongoing compliance monitoring',
          status: 'not_started',
          confidence_posture: 'needs_sme',
          word_limit: 1000,
          has_response: false,
          review_status: null,
        },
      ],
    },
  ],
  status_breakdown: { complete: 3, ai_drafted: 4, not_started: 3 },
  confidence_breakdown: {
    strong_match: 4,
    partial_match: 3,
    needs_sme: 2,
    no_content: 1,
  },
};

describe('formatBidDetail', () => {
  it('returns Markdown with bid name and status', () => {
    const result = formatBidDetail(sampleBidDetail);

    expect(result).toContain('# NHS Digital Transformation');
    expect(result).toContain('**Status:** active');
    expect(result).toContain('**Buyer:** NHS England');
  });

  it('includes question stats section', () => {
    const result = formatBidDetail(sampleBidDetail);

    expect(result).toContain('## Question Progress');
    expect(result).toContain('**Total questions:** 10');
    expect(result).toContain('**Strong KB match:** 4');
  });

  it('formats bid detail with sections and question list', () => {
    const result = formatBidDetail(sampleBidDetail);

    expect(result).toContain('## Questions by Section');
    expect(result).toContain('### Organisation (2 questions)');
    expect(result).toContain('### Technical (1 questions)');
    expect(result).toContain('Describe your organisation structure');
    expect(result).toContain('How many employees do you have?');
  });

  it('handles empty sections array', () => {
    const noSections: BidDetail = {
      ...sampleBidDetail,
      sections: [],
    };
    const result = formatBidDetail(noSections);

    expect(result).not.toContain('## Questions by Section');
  });

  it('truncates long question text in Markdown', () => {
    const result = formatBidDetail(sampleBidDetail);

    // q3 has 107 characters — should be truncated to 97 + '...'
    expect(result).toContain(
      'Describe your approach to information security including ISO 27001 certification and ongoing comp...',
    );
  });

  it('shows response status icon for answered questions', () => {
    const result = formatBidDetail(sampleBidDetail);

    // q1 and q2 have responses (has_response: true)
    // Use check mark for responded, empty square for not
    expect(result).toContain('\u2705'); // has_response = true
    expect(result).toContain('\u2B1C'); // has_response = false
  });

  it('includes confidence posture in question lines', () => {
    const result = formatBidDetail(sampleBidDetail);

    expect(result).toContain('[strong match]');
    expect(result).toContain('[partial match]');
    expect(result).toContain('[needs sme]');
  });

  it('includes status breakdown section', () => {
    const result = formatBidDetail(sampleBidDetail);

    expect(result).toContain('## Status Breakdown');
    expect(result).toContain('**complete:** 3');
    expect(result).toContain('**ai drafted:** 4');
    expect(result).toContain('**not started:** 3');
  });

  it('omits status breakdown when empty', () => {
    const noBreakdown: BidDetail = {
      ...sampleBidDetail,
      status_breakdown: {},
    };
    const result = formatBidDetail(noBreakdown);

    expect(result).not.toContain('## Status Breakdown');
  });

  it('includes confidence breakdown section', () => {
    const result = formatBidDetail(sampleBidDetail);

    expect(result).toContain('## Confidence Breakdown');
    expect(result).toContain('**strong match:** 4');
    expect(result).toContain('**partial match:** 3');
  });

  it('omits confidence breakdown when empty', () => {
    const noBreakdown: BidDetail = {
      ...sampleBidDetail,
      confidence_breakdown: {},
    };
    const result = formatBidDetail(noBreakdown);

    expect(result).not.toContain('## Confidence Breakdown');
  });
});
