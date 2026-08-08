import { describe, it, expect } from 'vitest';
import {
  formatIntelligenceSummary,
  type IntelligenceSummaryData,
} from '@/lib/mcp/formatters/intelligence';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function makeSummaryData(
  overrides: Partial<IntelligenceSummaryData> = {},
): IntelligenceSummaryData {
  return {
    workspace_id: WORKSPACE_ID,
    workspace_name: 'Cyber Security Intel',
    period: '7d',
    period_label: 'Last 7 days',
    total_ingested: 50,
    total_passed: 20,
    total_filtered: 30,
    filter_ratio: 0.6,
    by_category: { 'Data Breaches': 12, Ransomware: 8 },
    by_source: [
      { source_name: 'Dark Reading', article_count: 30, passed_count: 12 },
      { source_name: 'The Register', article_count: 20, passed_count: 8 },
    ],
    top_articles: [
      {
        id: 'art-001',
        title: 'Major Data Breach at TechCorp',
        source_name: 'Dark Reading',
        external_url: 'https://example.com/article-1',
        relevance_score: 0.95,
        relevance_category: 'high',
        ai_summary: 'A significant breach affecting 10M users.',
        matched_categories: ['Data Breaches'],
        published_at: '2026-04-01T10:00:00Z',
        ingested_at: '2026-04-01T12:00:00Z',
      },
      {
        id: 'art-002',
        title: 'New Ransomware Strain Identified',
        source_name: 'The Register',
        external_url: 'https://example.com/article-2',
        relevance_score: 0.82,
        relevance_category: 'high',
        ai_summary: null,
        matched_categories: ['Ransomware'],
        published_at: null,
        ingested_at: '2026-04-02T08:00:00Z',
      },
    ],
    unresolved_flags: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatIntelligenceSummary', () => {
  it('produces correct Markdown structure', () => {
    const md = formatIntelligenceSummary(makeSummaryData());

    // Should have main sections
    expect(md).toContain('# Intelligence Summary:');
    expect(md).toContain('## Overview');
    expect(md).toContain('## By Category');
    expect(md).toContain('## By Source');
    expect(md).toContain('## Top Articles');
  });

  it('includes workspace name in heading', () => {
    const md = formatIntelligenceSummary(makeSummaryData());
    expect(md).toContain('# Intelligence Summary: Cyber Security Intel');
  });

  it('includes period label', () => {
    const md = formatIntelligenceSummary(makeSummaryData());
    expect(md).toContain('**Period:** Last 7 days');
  });

  it('renders category table when data exists', () => {
    const md = formatIntelligenceSummary(makeSummaryData());
    expect(md).toContain('| Data Breaches | 12 |');
    expect(md).toContain('| Ransomware | 8 |');
  });

  it('renders source table when data exists', () => {
    const md = formatIntelligenceSummary(makeSummaryData());
    expect(md).toContain('| Dark Reading | 30 | 12 |');
    expect(md).toContain('| The Register | 20 | 8 |');
  });

  it('handles empty categories gracefully', () => {
    const md = formatIntelligenceSummary(makeSummaryData({ by_category: {} }));
    expect(md).not.toContain('## By Category');
  });

  it('handles empty sources gracefully', () => {
    const md = formatIntelligenceSummary(makeSummaryData({ by_source: [] }));
    expect(md).not.toContain('## By Source');
  });

  it('handles empty top articles with placeholder message', () => {
    const md = formatIntelligenceSummary(makeSummaryData({ top_articles: [] }));
    expect(md).toContain(
      'No articles passed the relevance filter in this period.',
    );
    expect(md).not.toContain('## Top Articles');
  });

  it('formats published dates in UK format (DD/MM/YYYY)', () => {
    const md = formatIntelligenceSummary(makeSummaryData());
    // 2026-04-01 should render as 01/04/2026
    expect(md).toContain('01/04/2026');
  });

  it('falls back to ingested_at when published_at is null', () => {
    const md = formatIntelligenceSummary(makeSummaryData());
    // Article 2 has null published_at, ingested_at is 2026-04-02
    expect(md).toContain('02/04/2026');
  });

  it('includes relevance score badge', () => {
    const md = formatIntelligenceSummary(makeSummaryData());
    expect(md).toContain('[HIGH 95%]');
    expect(md).toContain('[HIGH 82%]');
  });

  it('includes article summary when present', () => {
    const md = formatIntelligenceSummary(makeSummaryData());
    expect(md).toContain('A significant breach affecting 10M users.');
  });

  it('includes article categories', () => {
    const md = formatIntelligenceSummary(makeSummaryData());
    expect(md).toContain('**Categories:** Data Breaches');
    expect(md).toContain('**Categories:** Ransomware');
  });

  it('includes article links', () => {
    const md = formatIntelligenceSummary(makeSummaryData());
    expect(md).toContain('[Read more](https://example.com/article-1)');
    expect(md).toContain('[Read more](https://example.com/article-2)');
  });

  it('shows overview stats in table', () => {
    const md = formatIntelligenceSummary(makeSummaryData());
    expect(md).toContain('| Total ingested | 50 |');
    expect(md).toContain('| Passed filter | 20 |');
    expect(md).toContain('| Filtered out | 30 |');
    expect(md).toContain('| Filter ratio | 60% |');
    expect(md).toContain('| Unresolved flags | 3 |');
  });
});
