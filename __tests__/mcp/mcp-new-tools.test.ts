import { describe, it, expect } from 'vitest';
import {
  formatCoverageGaps,
  formatAuditResult,
  formatUpdatedItem,
  formatSimilarItems,
  formatBatchContentItems,
  type CoverageGapResult,
  type AuditResult,
  type AuditItem,
  type UpdatedItemResult,
  type SimilarItemsResult,
  type BatchContentItemsResult,
  type ContentItemDetail,
} from '@/lib/mcp/formatters';

// ──────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────

const sampleCoverageGaps: CoverageGapResult = {
  total_gaps: 5,
  empty_subtopics: [
    { domain: 'Security', subtopic: 'Penetration Testing' },
    { domain: 'Compliance & Governance', subtopic: 'GDPR Compliance' },
  ],
  thin_subtopics: [
    { domain: 'IT & Infrastructure', subtopic: 'Cloud Services', item_count: 2 },
    { domain: 'Operations', subtopic: 'Supply Chain', item_count: 1 },
  ],
  stale_only_subtopics: [
    { domain: 'Security', subtopic: 'Incident Response', stale_count: 2, expired_count: 1 },
  ],
};

const sampleAuditItem: AuditItem = {
  id: 'item-001',
  title: 'Old Policy',
  suggested_title: 'Security Policy (Outdated)',
  content_type: 'policy',
  primary_domain: 'Security',
  issues: ['thin_content', 'missing_summary'],
  content_length: 15,
  classification_confidence: 0.45,
  freshness: 'stale',
};

const sampleAuditResult: AuditResult = {
  total_flagged: 3,
  by_issue_type: {
    thin_content: 2,
    missing_summary: 1,
    low_confidence: 1,
  },
  items: [
    sampleAuditItem,
    {
      id: 'item-002',
      title: null,
      suggested_title: 'Untitled Q&A',
      content_type: 'q_a_pair',
      primary_domain: null,
      issues: ['no_domain', 'thin_content'],
      content_length: 5,
      classification_confidence: null,
      freshness: null,
    },
    {
      id: 'item-003',
      title: 'ISO Compliance',
      suggested_title: null,
      content_type: 'certification',
      primary_domain: 'Compliance & Governance',
      issues: ['low_confidence'],
      content_length: 500,
      classification_confidence: 0.35,
      freshness: 'fresh',
    },
  ],
};

const sampleUpdatedItem: UpdatedItemResult = {
  id: 'item-001',
  updated_fields: ['content', 'answer_standard'],
  previous_values: {
    content: 'Old content',
    answer_standard: 'Old answer',
  },
  reason: 'Enriched thin answer with detail from related policies',
};

const sampleSimilarItems: SimilarItemsResult = {
  source_item: { id: 'item-001', title: 'ISO 27001 Certification' },
  similar_items: [
    {
      id: 'item-002',
      title: null,
      suggested_title: 'ISO 27001 Compliance',
      content_type: 'certification',
      primary_domain: 'Compliance & Governance',
      similarity: 0.96,
      likely_duplicate: true,
    },
    {
      id: 'item-003',
      title: 'Information Security Management',
      suggested_title: null,
      content_type: 'policy',
      primary_domain: 'Security',
      similarity: 0.82,
      likely_duplicate: false,
    },
  ],
};

const sampleContentItem: ContentItemDetail = {
  id: 'item-001',
  title: 'ISO 27001',
  suggested_title: 'ISO 27001 Certification',
  content_type: 'certification',
  primary_domain: 'Compliance & Governance',
  primary_subtopic: 'ISO Standards',
  ai_summary: 'Summary of ISO 27001 certification',
  ai_keywords: ['ISO 27001', 'information security'],
  freshness: 'fresh',
  classification_confidence: 0.92,
  source_url: null,
  content: 'ISO 27001 is an international standard for information security management.',
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-03-01T14:30:00Z',
  governance_review_status: null,
  priority: 'high',
};

// ──────────────────────────────────────────
// formatCoverageGaps
// ──────────────────────────────────────────

describe('formatCoverageGaps', () => {
  it('formats all gap types with counts', () => {
    const result = formatCoverageGaps(sampleCoverageGaps);

    expect(result).toContain('# Coverage Gaps');
    expect(result).toContain('**Total gaps found:** 5');
  });

  it('includes empty subtopics section', () => {
    const result = formatCoverageGaps(sampleCoverageGaps);

    expect(result).toContain('## Empty Subtopics (0 items)');
    expect(result).toContain('Security > Penetration Testing');
    expect(result).toContain('Compliance & Governance > GDPR Compliance');
  });

  it('includes thin subtopics with item counts', () => {
    const result = formatCoverageGaps(sampleCoverageGaps);

    expect(result).toContain('## Thin Subtopics');
    expect(result).toContain('IT & Infrastructure > Cloud Services (2 items)');
    expect(result).toContain('Operations > Supply Chain (1 item)');
  });

  it('includes stale-only subtopics', () => {
    const result = formatCoverageGaps(sampleCoverageGaps);

    expect(result).toContain('## Stale-Only Subtopics');
    expect(result).toContain('Security > Incident Response (2 stale, 1 expired)');
  });

  it('handles zero gaps', () => {
    const noGaps: CoverageGapResult = {
      total_gaps: 0,
      empty_subtopics: [],
      thin_subtopics: [],
      stale_only_subtopics: [],
    };
    const result = formatCoverageGaps(noGaps);

    expect(result).toContain('**Total gaps found:** 0');
    expect(result).toContain('No coverage gaps found');
  });

  it('handles only empty subtopics', () => {
    const onlyEmpty: CoverageGapResult = {
      total_gaps: 1,
      empty_subtopics: [{ domain: 'Security', subtopic: 'Pen Testing' }],
      thin_subtopics: [],
      stale_only_subtopics: [],
    };
    const result = formatCoverageGaps(onlyEmpty);

    expect(result).toContain('## Empty Subtopics');
    expect(result).not.toContain('## Thin Subtopics');
    expect(result).not.toContain('## Stale-Only Subtopics');
  });
});

// ──────────────────────────────────────────
// formatAuditResult
// ──────────────────────────────────────────

describe('formatAuditResult', () => {
  it('formats audit summary with issue counts', () => {
    const result = formatAuditResult(sampleAuditResult);

    expect(result).toContain('# Content Audit');
    expect(result).toContain('**Total items flagged:** 3');
  });

  it('lists issues by type sorted by count', () => {
    const result = formatAuditResult(sampleAuditResult);

    expect(result).toContain('## Issues by Type');
    expect(result).toContain('**thin content:** 2');
    expect(result).toContain('**missing summary:** 1');
    expect(result).toContain('**low confidence:** 1');
  });

  it('includes flagged items with details', () => {
    const result = formatAuditResult(sampleAuditResult);

    expect(result).toContain('Security Policy (Outdated)');
    expect(result).toContain('**Issues:** thin content, missing summary');
    expect(result).toContain('**Content length:** 15 chars');
    expect(result).toContain('**Confidence:** 45%');
  });

  it('handles items with null title using suggested_title', () => {
    const result = formatAuditResult(sampleAuditResult);

    expect(result).toContain('Untitled Q&A');
  });

  it('handles zero flagged items', () => {
    const noIssues: AuditResult = {
      total_flagged: 0,
      by_issue_type: {},
      items: [],
    };
    const result = formatAuditResult(noIssues);

    expect(result).toContain('No quality issues found');
  });

  it('replaces underscores in issue names with spaces', () => {
    const result = formatAuditResult(sampleAuditResult);

    expect(result).toContain('thin content');
    expect(result).not.toContain('thin_content');
  });
});

// ──────────────────────────────────────────
// formatUpdatedItem
// ──────────────────────────────────────────

describe('formatUpdatedItem', () => {
  it('formats update confirmation with fields and reason', () => {
    const result = formatUpdatedItem(sampleUpdatedItem);

    expect(result).toContain('# Content Item Updated');
    expect(result).toContain('**ID:** item-001');
    expect(result).toContain('**Fields updated:** content, answer_standard');
    expect(result).toContain('**Reason:** Enriched thin answer');
  });

  it('omits reason when null', () => {
    const noReason: UpdatedItemResult = {
      ...sampleUpdatedItem,
      reason: null,
    };
    const result = formatUpdatedItem(noReason);

    expect(result).not.toContain('**Reason:**');
  });

  it('includes success message', () => {
    const result = formatUpdatedItem(sampleUpdatedItem);

    expect(result).toContain('updated successfully');
  });
});

// ──────────────────────────────────────────
// formatSimilarItems
// ──────────────────────────────────────────

describe('formatSimilarItems', () => {
  it('formats similar items with source title', () => {
    const result = formatSimilarItems(sampleSimilarItems);

    expect(result).toContain('# Similar Items to "ISO 27001 Certification"');
    expect(result).toContain('Found 2 similar items');
  });

  it('flags likely duplicates above 95%', () => {
    const result = formatSimilarItems(sampleSimilarItems);

    expect(result).toContain('[LIKELY DUPLICATE]');
    expect(result).toContain('ISO 27001 Compliance');
    expect(result).toContain('**Similarity:** 96%');
  });

  it('shows non-duplicates without flag', () => {
    const result = formatSimilarItems(sampleSimilarItems);

    // The non-duplicate item should not have the flag
    const lines = result.split('\n');
    const securityLine = lines.find(l => l.includes('Information Security Management'));
    expect(securityLine).not.toContain('LIKELY DUPLICATE');
  });

  it('handles no similar items found', () => {
    const noSimilar: SimilarItemsResult = {
      source_item: { id: 'item-001', title: 'Unique Item' },
      similar_items: [],
    };
    const result = formatSimilarItems(noSimilar);

    expect(result).toContain('No similar items found');
  });

  it('uses suggested_title when title is null', () => {
    const result = formatSimilarItems(sampleSimilarItems);

    expect(result).toContain('ISO 27001 Compliance');
  });

  it('uses "Untitled" when both titles are null', () => {
    const untitled: SimilarItemsResult = {
      source_item: { id: 'item-001', title: 'Source' },
      similar_items: [{
        id: 'item-002',
        title: null,
        suggested_title: null,
        content_type: 'other',
        primary_domain: null,
        similarity: 0.85,
        likely_duplicate: false,
      }],
    };
    const result = formatSimilarItems(untitled);

    expect(result).toContain('Untitled');
  });

  it('formats singular item correctly', () => {
    const single: SimilarItemsResult = {
      source_item: { id: 'item-001', title: 'Source' },
      similar_items: [{
        id: 'item-002',
        title: 'Related',
        suggested_title: null,
        content_type: 'article',
        primary_domain: 'Security',
        similarity: 0.88,
        likely_duplicate: false,
      }],
    };
    const result = formatSimilarItems(single);

    expect(result).toContain('Found 1 similar item:');
  });
});

// ──────────────────────────────────────────
// formatBatchContentItems
// ──────────────────────────────────────────

describe('formatBatchContentItems', () => {
  it('formats batch results with item count', () => {
    const batch: BatchContentItemsResult = {
      count: 2,
      items: [sampleContentItem, { ...sampleContentItem, id: 'item-002', title: 'Second Item' }],
      not_found: [],
    };
    const result = formatBatchContentItems(batch);

    expect(result).toContain('# 2 Content Items');
  });

  it('reports not-found IDs', () => {
    const batch: BatchContentItemsResult = {
      count: 1,
      items: [sampleContentItem],
      not_found: ['missing-001', 'missing-002'],
    };
    const result = formatBatchContentItems(batch);

    expect(result).toContain('**Not found:** 2 IDs returned no result');
  });

  it('formats each item using formatContentItem', () => {
    const batch: BatchContentItemsResult = {
      count: 1,
      items: [sampleContentItem],
      not_found: [],
    };
    const result = formatBatchContentItems(batch);

    expect(result).toContain('ISO 27001 Certification');
    expect(result).toContain('**Domain:** Compliance & Governance > ISO Standards');
    expect(result).toContain('**Freshness:** fresh');
  });

  it('handles singular count', () => {
    const batch: BatchContentItemsResult = {
      count: 1,
      items: [sampleContentItem],
      not_found: [],
    };
    const result = formatBatchContentItems(batch);

    expect(result).toContain('# 1 Content Item');
    expect(result).not.toContain('Items');
  });

  it('handles no not_found IDs', () => {
    const batch: BatchContentItemsResult = {
      count: 1,
      items: [sampleContentItem],
      not_found: [],
    };
    const result = formatBatchContentItems(batch);

    expect(result).not.toContain('**Not found:**');
  });

  it('separates items with dividers', () => {
    const batch: BatchContentItemsResult = {
      count: 2,
      items: [sampleContentItem, { ...sampleContentItem, id: 'item-002' }],
      not_found: [],
    };
    const result = formatBatchContentItems(batch);

    expect(result).toContain('---');
  });
});
