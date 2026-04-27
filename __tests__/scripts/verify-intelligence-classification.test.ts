import { describe, it, expect } from 'vitest';
import {
  analyseItems,
  formatReport,
  safePercent,
  type VerificationItem,
  type VerificationResult,
} from '../../scripts/verify-intelligence-classification';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_DOMAINS = new Set([
  'Legislation & Policy',
  'Market Intelligence',
  'Sector News',
  'Technical Standards',
]);

const VALID_SUBTOPICS = new Set([
  'Regulatory Changes',
  'Procurement Policy',
  'Industry Trends',
  'Competitor Activity',
  'Sector Updates',
  'Compliance Frameworks',
]);

function makeItem(overrides: Partial<VerificationItem> = {}): VerificationItem {
  return {
    content_item_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    title: 'Test Article',
    primary_domain: 'Legislation & Policy',
    primary_subtopic: 'Regulatory Changes',
    has_embedding: true,
    entity_count: 3,
    ...overrides,
  };
}

function makeItems(
  count: number,
  overrides: Partial<VerificationItem> = {},
): VerificationItem[] {
  return Array.from({ length: count }, (_, i) =>
    makeItem({
      content_item_id: `a1b2c3d4-e5f6-4a7b-8c9d-${String(i).padStart(12, '0')}`,
      title: `Article ${i + 1}`,
      ...overrides,
    }),
  );
}

// ---------------------------------------------------------------------------
// safePercent
// ---------------------------------------------------------------------------

describe('safePercent', () => {
  it('returns 0 for zero total', () => {
    expect(safePercent(5, 0)).toBe(0);
  });

  it('returns correct percentage with one decimal place', () => {
    expect(safePercent(1, 3)).toBeCloseTo(33.3, 1);
  });

  it('returns 100 when count equals total', () => {
    expect(safePercent(10, 10)).toBe(100);
  });

  it('returns 0 when count is 0', () => {
    expect(safePercent(0, 10)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// analyseItems
// ---------------------------------------------------------------------------

describe('analyseItems', () => {
  it('counts classified items correctly', () => {
    const items = [
      makeItem({
        primary_domain: 'Legislation & Policy',
        primary_subtopic: 'Regulatory Changes',
      }),
      makeItem({
        primary_domain: null,
        primary_subtopic: 'Regulatory Changes',
      }),
      makeItem({
        primary_domain: 'Market Intelligence',
        primary_subtopic: null,
      }),
      makeItem({ primary_domain: null, primary_subtopic: null }),
    ];

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.classified_count).toBe(1);
    expect(result.unclassified_count).toBe(3);
  });

  it('counts items with missing domain as unclassified', () => {
    const items = [
      makeItem({
        primary_domain: null,
        primary_subtopic: 'Regulatory Changes',
      }),
    ];

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.unclassified_count).toBe(1);
    expect(result.classified_count).toBe(0);
  });

  it('counts items with missing subtopic as unclassified', () => {
    const items = [
      makeItem({
        primary_domain: 'Legislation & Policy',
        primary_subtopic: null,
      }),
    ];

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.unclassified_count).toBe(1);
    expect(result.classified_count).toBe(0);
  });

  it('counts entity coverage correctly', () => {
    const items = [
      makeItem({ entity_count: 5 }),
      makeItem({ entity_count: 0 }),
      makeItem({ entity_count: 2 }),
    ];

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.entity_coverage_count).toBe(2);
    expect(result.entity_coverage_rate).toBeCloseTo(66.7, 1);
  });

  it('counts items without entity_mentions as lacking entity coverage', () => {
    const items = makeItems(3, { entity_count: 0 });

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.entity_coverage_count).toBe(0);
    expect(result.entity_coverage_rate).toBe(0);
  });

  it('flags invalid domain names as issues', () => {
    const items = [makeItem({ primary_domain: 'Nonexistent Domain' })];

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.invalid_domains).toContain('Nonexistent Domain');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        issue: 'Invalid domain: "Nonexistent Domain"',
      }),
    );
  });

  it('flags invalid subtopic names as issues', () => {
    const items = [makeItem({ primary_subtopic: 'Made Up Subtopic' })];

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.invalid_subtopics).toContain('Made Up Subtopic');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        issue: 'Invalid subtopic: "Made Up Subtopic"',
      }),
    );
  });

  it('aggregates domain distribution correctly', () => {
    const items = [
      makeItem({ primary_domain: 'Legislation & Policy' }),
      makeItem({ primary_domain: 'Legislation & Policy' }),
      makeItem({ primary_domain: 'Market Intelligence' }),
      makeItem({ primary_domain: null }),
    ];

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.domain_distribution).toEqual({
      'Legislation & Policy': 2,
      'Market Intelligence': 1,
    });
  });

  it('passes through entity type distribution', () => {
    const entityTypes = { Organisation: 10, Person: 5, Location: 3 };

    const result = analyseItems(
      [makeItem()],
      VALID_DOMAINS,
      VALID_SUBTOPICS,
      entityTypes,
    );

    expect(result.entity_type_distribution).toEqual(entityTypes);
  });

  it('calculates average entities per item correctly', () => {
    const items = [
      makeItem({ entity_count: 4 }),
      makeItem({ entity_count: 6 }),
      makeItem({ entity_count: 2 }),
    ];

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.average_entities_per_item).toBe(4);
  });

  it('handles empty result set without divide-by-zero', () => {
    const result = analyseItems([], VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.total_items).toBe(0);
    expect(result.classified_count).toBe(0);
    expect(result.unclassified_count).toBe(0);
    expect(result.classification_rate).toBe(0);
    expect(result.entity_coverage_rate).toBe(0);
    expect(result.embedding_coverage_rate).toBe(0);
    expect(result.average_entities_per_item).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it('caps issues at 50', () => {
    // Create 60 items all missing domain — each generates at least 1 issue
    const items = makeItems(60, {
      primary_domain: null,
      primary_subtopic: null,
      has_embedding: false,
      entity_count: 0,
    });

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.issues.length).toBeLessThanOrEqual(50);
  });

  it('counts embedding coverage correctly', () => {
    const items = [
      makeItem({ has_embedding: true }),
      makeItem({ has_embedding: false }),
      makeItem({ has_embedding: true }),
    ];

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.embedding_coverage_count).toBe(2);
    expect(result.embedding_coverage_rate).toBeCloseTo(66.7, 1);
  });

  it('does not double-count invalid domains', () => {
    const items = [
      makeItem({
        primary_domain: 'Bad Domain',
        content_item_id: 'a1b2c3d4-e5f6-4a7b-8c9d-000000000001',
      }),
      makeItem({
        primary_domain: 'Bad Domain',
        content_item_id: 'a1b2c3d4-e5f6-4a7b-8c9d-000000000002',
      }),
    ];

    const result = analyseItems(items, VALID_DOMAINS, VALID_SUBTOPICS, {});

    expect(result.invalid_domains).toHaveLength(1);
    expect(result.invalid_domains[0]).toBe('Bad Domain');
  });
});

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

describe('formatReport', () => {
  function makeResult(
    overrides: Partial<VerificationResult> = {},
  ): VerificationResult {
    return {
      total_items: 10,
      classified_count: 8,
      unclassified_count: 2,
      classification_rate: 80,
      entity_coverage_count: 7,
      entity_coverage_rate: 70,
      embedding_coverage_count: 9,
      embedding_coverage_rate: 90,
      domain_distribution: {
        'Legislation & Policy': 5,
        'Market Intelligence': 3,
      },
      subtopic_distribution: { 'Regulatory Changes': 4, 'Industry Trends': 3 },
      entity_type_distribution: { Organisation: 12, Person: 5 },
      average_entities_per_item: 3.2,
      issues: [],
      invalid_domains: [],
      invalid_subtopics: [],
      ...overrides,
    };
  }

  it('produces valid Markdown with expected sections', () => {
    const report = formatReport(makeResult());

    expect(report).toContain(
      '# Intelligence Classification Verification Report',
    );
    expect(report).toContain('## Coverage Summary');
    expect(report).toContain('## Domain Distribution');
    expect(report).toContain('## Subtopic Distribution');
    expect(report).toContain('## Entity Type Distribution');
  });

  it('includes total items count', () => {
    const report = formatReport(makeResult({ total_items: 42 }));
    expect(report).toContain('**Total items analysed:** 42');
  });

  it('renders coverage summary table', () => {
    const report = formatReport(makeResult());

    expect(report).toContain(
      '| Classification (domain + subtopic) | 8/10 | 80% |',
    );
    expect(report).toContain('| Entity extraction | 7/10 | 70% |');
    expect(report).toContain('| Embeddings | 9/10 | 90% |');
  });

  it('renders domain distribution table', () => {
    const report = formatReport(makeResult());

    expect(report).toContain('| Legislation & Policy | 5 |');
    expect(report).toContain('| Market Intelligence | 3 |');
  });

  it('renders entity type distribution table', () => {
    const report = formatReport(makeResult());

    expect(report).toContain('| Organisation | 12 |');
    expect(report).toContain('| Person | 5 |');
  });

  it('renders issues table when present', () => {
    const report = formatReport(
      makeResult({
        issues: [
          {
            item_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
            title: 'Test',
            issue: 'Missing primary_domain',
          },
        ],
      }),
    );

    expect(report).toContain('## Issues');
    expect(report).toContain('Missing primary_domain');
  });

  it('shows "No issues found" when issues list is empty', () => {
    const report = formatReport(makeResult({ issues: [] }));
    expect(report).toContain('_No issues found._');
  });

  it('omits domain distribution section when empty', () => {
    const report = formatReport(makeResult({ domain_distribution: {} }));
    expect(report).not.toContain('## Domain Distribution');
  });

  it('includes average entities per item', () => {
    const report = formatReport(makeResult({ average_entities_per_item: 4.5 }));
    expect(report).toContain('**Average entities per item:** 4.5');
  });

  it('renders invalid domains section when present', () => {
    const report = formatReport(
      makeResult({ invalid_domains: ['Bad Domain'] }),
    );

    expect(report).toContain('## Invalid Domains');
    expect(report).toContain('- Bad Domain');
  });

  it('renders invalid subtopics section when present', () => {
    const report = formatReport(
      makeResult({ invalid_subtopics: ['Bad Subtopic'] }),
    );

    expect(report).toContain('## Invalid Subtopics');
    expect(report).toContain('- Bad Subtopic');
  });
});
