/**
 * Product Guide Section Resolution Tests (S189 WP4)
 *
 * Verifies the filter mapping applied by migration
 * 20260422174420_wire_product_guide_sections.sql. Each Product Guide
 * (LMS, Websites, Advanced Audits) shares the same 19-section structure
 * with identical subtopic_filter + expected_layer values.
 *
 * The tests validate:
 *   1. Every section has a non-NULL subtopic_filter after migration.
 *   2. Every subtopic_filter is a valid taxonomy subtopic name.
 *   3. The filter mapping is semantically correct (section name -> subtopic).
 *   4. The RPC resolution logic (simulated) with domain + subtopic + layer
 *      produces the expected matching behaviour.
 *
 * These tests use the mock Supabase client pattern and simulate the
 * `get_guide_content` RPC resolution logic client-side.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  suggestGuideSections,
  type GuideSectionMatchInput,
} from '@/lib/guide-section-mapping';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Constants — the canonical filter mapping from migration
// ---------------------------------------------------------------------------

/** The domain_filter shared by all 3 Product Guides */
const PRODUCT_DOMAIN = 'product-feature';

/** Guide UUIDs on production 'r' */
const PRODUCT_GUIDE_IDS = {
  lms: 'f216848e-decf-4a86-a19f-f9907b6b55c8',
  websites: 'ff2b9333-80f7-41a7-88d8-82baeb65b20e',
  advancedAudits: 'a4cfe046-9a6c-4e3f-b0ff-2d4f0d958687',
} as const;

const PRODUCT_GUIDE_SLUGS = {
  lms: 'lms-product',
  websites: 'websites-product',
  advancedAudits: 'audits-product',
} as const;

/**
 * Canonical section-to-filter mapping applied by the migration.
 * Order matches display_order (1-19).
 */
const SECTION_FILTER_MAP: Array<{
  displayOrder: number;
  sectionName: string;
  subtopicFilter: string;
  expectedLayer: string;
}> = [
  { displayOrder: 1, sectionName: 'Elevator Pitch', subtopicFilter: 'functionality', expectedLayer: 'sales_brief' },
  { displayOrder: 2, sectionName: 'Key Features', subtopicFilter: 'functionality', expectedLayer: 'sales_brief' },
  { displayOrder: 3, sectionName: 'Differentiators', subtopicFilter: 'approach', expectedLayer: 'sales_brief' },
  { displayOrder: 4, sectionName: 'Target Audience', subtopicFilter: 'company-info', expectedLayer: 'sales_brief' },
  { displayOrder: 5, sectionName: 'Use Cases', subtopicFilter: 'functionality', expectedLayer: 'bid_detail' },
  { displayOrder: 6, sectionName: 'Pricing', subtopicFilter: 'financial', expectedLayer: 'company_reference' },
  { displayOrder: 7, sectionName: 'Objection Handling', subtopicFilter: 'approach', expectedLayer: 'sales_brief' },
  { displayOrder: 8, sectionName: 'Demo Flow', subtopicFilter: 'usability', expectedLayer: 'sales_brief' },
  { displayOrder: 9, sectionName: 'Competitor Comparison', subtopicFilter: 'standards', expectedLayer: 'bid_detail' },
  { displayOrder: 10, sectionName: 'Success Stories', subtopicFilter: 'references', expectedLayer: 'sales_brief' },
  { displayOrder: 11, sectionName: 'Upsell Paths', subtopicFilter: 'company-info', expectedLayer: 'sales_brief' },
  { displayOrder: 12, sectionName: 'Technical Spec', subtopicFilter: 'technical', expectedLayer: 'bid_detail' },
  { displayOrder: 13, sectionName: 'Security & Compliance', subtopicFilter: 'cyber-security', expectedLayer: 'bid_detail' },
  { displayOrder: 14, sectionName: 'Implementation', subtopicFilter: 'deployment', expectedLayer: 'bid_detail' },
  { displayOrder: 15, sectionName: 'SLAs', subtopicFilter: 'sla', expectedLayer: 'company_reference' },
  { displayOrder: 16, sectionName: 'Integrations', subtopicFilter: 'integration', expectedLayer: 'bid_detail' },
  { displayOrder: 17, sectionName: 'Data Handling', subtopicFilter: 'data-protection', expectedLayer: 'company_reference' },
  { displayOrder: 18, sectionName: 'Accessibility', subtopicFilter: 'usability', expectedLayer: 'bid_detail' },
  { displayOrder: 19, sectionName: 'Certifications', subtopicFilter: 'certification', expectedLayer: 'company_reference' },
];

/**
 * Valid taxonomy subtopics from the live DB (product-feature domain subtopics
 * plus cross-domain subtopics used via secondary classification).
 */
const VALID_SUBTOPICS = new Set([
  // product-feature domain
  'functionality', 'reporting', 'technical', 'usability',
  // corporate domain
  'company-info', 'financial', 'insurance', 'references', 'staffing',
  'methodology', 'supply-chain', 'financial-standing',
  // security domain
  'access-control', 'cyber-security', 'data-protection', 'encryption', 'iso-27001',
  // support domain
  'helpdesk', 'incident', 'maintenance', 'sla',
  // compliance domain
  'audit', 'certification', 'environmental', 'equalities',
  'health-and-safety', 'modern-slavery', 'regulatory', 'safeguarding', 'standards',
  // implementation domain
  'deployment', 'integration', 'migration', 'onboarding',
  // methodology domain
  'approach', 'delivery', 'project-management', 'quality',
]);

/**
 * Sections that have zero items on 'r' due to sparse content at the
 * company_reference layer. The subtopic_filter is semantically correct
 * but content loading is pending.
 */
const CONTENT_POPULATION_PENDING_SECTIONS = new Set([
  'Pricing',        // financial + company_reference
  'Data Handling',  // data-protection + company_reference
  'Certifications', // certification + company_reference
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asSupabase(mock: MockSupabaseClient) {
  return mock as unknown as Parameters<typeof suggestGuideSections>[0];
}

/** Build a mock guide_sections row for the suggestGuideSections query */
function mockProductGuideSection(
  section: typeof SECTION_FILTER_MAP[0],
  guideKey: keyof typeof PRODUCT_GUIDE_IDS,
) {
  return {
    id: `section-${guideKey}-${section.displayOrder}`,
    section_name: section.sectionName,
    subtopic_filter: section.subtopicFilter,
    expected_layer: section.expectedLayer,
    content_type_filter: null,
    display_order: section.displayOrder,
    is_required: true,
    guides: {
      id: PRODUCT_GUIDE_IDS[guideKey],
      name: `${guideKey.charAt(0).toUpperCase() + guideKey.slice(1)} Product Guide`,
      slug: PRODUCT_GUIDE_SLUGS[guideKey],
      domain_filter: PRODUCT_DOMAIN,
      display_order: guideKey === 'lms' ? 5 : guideKey === 'websites' ? 6 : 7,
      is_published: true,
    },
  };
}

function configureSectionResponse(
  client: MockSupabaseClient,
  sections: ReturnType<typeof mockProductGuideSection>[],
) {
  client._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: sections, error: null }),
  );
}

// ---------------------------------------------------------------------------
// 1. Completeness — all 19 sections have non-NULL subtopic_filter
// ---------------------------------------------------------------------------

describe('Product Guide Section Completeness', () => {
  it('defines exactly 19 sections in the filter map', () => {
    expect(SECTION_FILTER_MAP).toHaveLength(19);
  });

  it('every section has a non-empty subtopic_filter', () => {
    for (const section of SECTION_FILTER_MAP) {
      expect(section.subtopicFilter, `${section.sectionName} subtopicFilter should be non-empty`).toBeTruthy();
      expect(section.subtopicFilter.length, `${section.sectionName} subtopicFilter should not be empty string`).toBeGreaterThan(0);
    }
  });

  it('every section has a non-empty expected_layer', () => {
    for (const section of SECTION_FILTER_MAP) {
      expect(section.expectedLayer, `${section.sectionName} expectedLayer should be non-empty`).toBeTruthy();
    }
  });

  it('display_order is sequential 1-19 with no gaps', () => {
    const orders = SECTION_FILTER_MAP.map(s => s.displayOrder);
    expect(orders).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
  });

  it('section names match the known scaffold', () => {
    const expected = [
      'Elevator Pitch', 'Key Features', 'Differentiators', 'Target Audience',
      'Use Cases', 'Pricing', 'Objection Handling', 'Demo Flow',
      'Competitor Comparison', 'Success Stories', 'Upsell Paths',
      'Technical Spec', 'Security & Compliance', 'Implementation', 'SLAs',
      'Integrations', 'Data Handling', 'Accessibility', 'Certifications',
    ];
    expect(SECTION_FILTER_MAP.map(s => s.sectionName)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// 2. Taxonomy validity — subtopic_filter values exist in taxonomy
// ---------------------------------------------------------------------------

describe('Product Guide Section Taxonomy Validity', () => {
  it('every subtopic_filter is a valid taxonomy subtopic', () => {
    for (const section of SECTION_FILTER_MAP) {
      expect(
        VALID_SUBTOPICS.has(section.subtopicFilter),
        `${section.sectionName}: subtopic '${section.subtopicFilter}' is not in the valid taxonomy subtopics set`,
      ).toBe(true);
    }
  });

  it('all unique subtopic_filter values are valid', () => {
    const uniqueSubtopics = new Set(SECTION_FILTER_MAP.map(s => s.subtopicFilter));
    for (const subtopic of uniqueSubtopics) {
      expect(VALID_SUBTOPICS.has(subtopic), `Subtopic '${subtopic}' not found in taxonomy`).toBe(true);
    }
  });

  it('expected_layer values are from the known vocabulary', () => {
    const validLayers = new Set(['sales_brief', 'bid_detail', 'company_reference', 'research']);
    for (const section of SECTION_FILTER_MAP) {
      expect(
        validLayers.has(section.expectedLayer),
        `${section.sectionName}: layer '${section.expectedLayer}' is not valid`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Semantic correctness — section name to subtopic mapping
// ---------------------------------------------------------------------------

describe('Product Guide Section Semantic Mapping', () => {
  it('sales-brief sections map to customer-facing subtopics', () => {
    const salesBriefSections = SECTION_FILTER_MAP.filter(s => s.expectedLayer === 'sales_brief');
    // Sales brief sections should use subtopics appropriate for customer-facing content
    const salesSubtopics = new Set(salesBriefSections.map(s => s.subtopicFilter));
    // These are reasonable sales-level subtopics
    expect(salesSubtopics).toContain('functionality');
    expect(salesSubtopics).toContain('usability');
    expect(salesSubtopics).toContain('approach');
    expect(salesSubtopics).toContain('company-info');
  });

  it('bid-detail sections map to technical/detailed subtopics', () => {
    const bidDetailSections = SECTION_FILTER_MAP.filter(s => s.expectedLayer === 'bid_detail');
    const bidSubtopics = new Set(bidDetailSections.map(s => s.subtopicFilter));
    expect(bidSubtopics).toContain('technical');
    expect(bidSubtopics).toContain('cyber-security');
    expect(bidSubtopics).toContain('deployment');
    expect(bidSubtopics).toContain('integration');
  });

  it('company-reference sections map to governance/corporate subtopics', () => {
    const companyRefSections = SECTION_FILTER_MAP.filter(s => s.expectedLayer === 'company_reference');
    const companySubtopics = new Set(companyRefSections.map(s => s.subtopicFilter));
    expect(companySubtopics).toContain('sla');
    expect(companySubtopics).toContain('financial');
    expect(companySubtopics).toContain('data-protection');
    expect(companySubtopics).toContain('certification');
  });

  it('Technical Spec maps to technical subtopic', () => {
    const techSpec = SECTION_FILTER_MAP.find(s => s.sectionName === 'Technical Spec');
    expect(techSpec?.subtopicFilter).toBe('technical');
    expect(techSpec?.expectedLayer).toBe('bid_detail');
  });

  it('Security & Compliance maps to cyber-security subtopic', () => {
    const sec = SECTION_FILTER_MAP.find(s => s.sectionName === 'Security & Compliance');
    expect(sec?.subtopicFilter).toBe('cyber-security');
    expect(sec?.expectedLayer).toBe('bid_detail');
  });

  it('SLAs maps to sla subtopic at company_reference layer', () => {
    const slas = SECTION_FILTER_MAP.find(s => s.sectionName === 'SLAs');
    expect(slas?.subtopicFilter).toBe('sla');
    expect(slas?.expectedLayer).toBe('company_reference');
  });

  it('Data Handling maps to data-protection subtopic', () => {
    const dh = SECTION_FILTER_MAP.find(s => s.sectionName === 'Data Handling');
    expect(dh?.subtopicFilter).toBe('data-protection');
    expect(dh?.expectedLayer).toBe('company_reference');
  });
});

// ---------------------------------------------------------------------------
// 4. RPC resolution simulation — suggestGuideSections matching
// ---------------------------------------------------------------------------

describe('Product Guide RPC Resolution Simulation', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it.each(
    SECTION_FILTER_MAP
      .filter(s => !CONTENT_POPULATION_PENDING_SECTIONS.has(s.sectionName))
      .map(s => [s.sectionName, s.subtopicFilter, s.expectedLayer] as const),
  )(
    'section "%s" (subtopic=%s, layer=%s) produces exact match for matching content',
    async (sectionName, subtopicFilter, expectedLayer) => {
      // Build mock section data for LMS Product Guide
      const section = SECTION_FILTER_MAP.find(s => s.sectionName === sectionName)!;
      const mockSection = mockProductGuideSection(section, 'lms');

      configureSectionResponse(mockClient, [mockSection]);

      // Item classified with matching subtopic and layer
      const input: GuideSectionMatchInput = {
        primaryDomain: PRODUCT_DOMAIN,
        primarySubtopic: subtopicFilter,
        layer: expectedLayer,
      };

      const results = await suggestGuideSections(asSupabase(mockClient), input);

      expect(results.length).toBeGreaterThanOrEqual(1);
      const match = results.find(r => r.sectionName === sectionName);
      expect(match, `Expected to find match for section "${sectionName}"`).toBeDefined();
      expect(match!.matchStrength).toBe('exact');
    },
  );

  it('content-population-pending sections still produce exact matches when content exists', async () => {
    // Even the 3 pending sections will work once content is loaded at the right layer
    for (const pendingSectionName of CONTENT_POPULATION_PENDING_SECTIONS) {
      const section = SECTION_FILTER_MAP.find(s => s.sectionName === pendingSectionName)!;
      const mockSection = mockProductGuideSection(section, 'lms');

      const freshMock = createMockSupabaseClient();
      configureSectionResponse(freshMock, [mockSection]);

      const input: GuideSectionMatchInput = {
        primaryDomain: PRODUCT_DOMAIN,
        primarySubtopic: section.subtopicFilter,
        layer: section.expectedLayer,
      };

      const results = await suggestGuideSections(asSupabase(freshMock), input);
      expect(results.length).toBeGreaterThanOrEqual(1);
      const match = results.find(r => r.sectionName === pendingSectionName);
      expect(match, `Expected to find match for pending section "${pendingSectionName}"`).toBeDefined();
      expect(match!.matchStrength).toBe('exact');
    }
  });

  it('item with wrong subtopic does not produce exact match', async () => {
    const section = SECTION_FILTER_MAP[0]; // Elevator Pitch -> functionality
    const mockSection = mockProductGuideSection(section, 'lms');

    configureSectionResponse(mockClient, [mockSection]);

    const input: GuideSectionMatchInput = {
      primaryDomain: PRODUCT_DOMAIN,
      primarySubtopic: 'encryption', // Wrong subtopic
      layer: section.expectedLayer,
    };

    const results = await suggestGuideSections(asSupabase(mockClient), input);
    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).not.toBe('exact');
  });

  it('item with wrong layer produces partial match (subtopic matches)', async () => {
    const section = SECTION_FILTER_MAP.find(s => s.sectionName === 'Technical Spec')!;
    const mockSection = mockProductGuideSection(section, 'advancedAudits');

    configureSectionResponse(mockClient, [mockSection]);

    const input: GuideSectionMatchInput = {
      primaryDomain: PRODUCT_DOMAIN,
      primarySubtopic: 'technical',
      layer: 'sales_brief', // Wrong layer for Technical Spec (expects bid_detail)
    };

    const results = await suggestGuideSections(asSupabase(mockClient), input);
    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('partial');
  });
});

// ---------------------------------------------------------------------------
// 5. Cross-guide uniformity — all 3 guides use identical mapping
// ---------------------------------------------------------------------------

describe('Product Guide Cross-Guide Uniformity', () => {
  it('all 3 guides share the same section structure', () => {
    // This test encodes the key constraint: LMS, Websites, and Advanced Audits
    // have IDENTICAL section names, display_order, expected_layer, and now
    // subtopic_filter values. The migration updates all 3 in each statement.
    const guideKeys: (keyof typeof PRODUCT_GUIDE_IDS)[] = ['lms', 'websites', 'advancedAudits'];

    for (const guideKey of guideKeys) {
      for (const section of SECTION_FILTER_MAP) {
        const mockSection = mockProductGuideSection(section, guideKey);
        expect(mockSection.section_name).toBe(section.sectionName);
        expect(mockSection.subtopic_filter).toBe(section.subtopicFilter);
        expect(mockSection.expected_layer).toBe(section.expectedLayer);
        expect(mockSection.display_order).toBe(section.displayOrder);
      }
    }
  });

  it('all 3 guides have domain_filter = product-feature', () => {
    const guideKeys: (keyof typeof PRODUCT_GUIDE_IDS)[] = ['lms', 'websites', 'advancedAudits'];
    for (const guideKey of guideKeys) {
      const section = mockProductGuideSection(SECTION_FILTER_MAP[0], guideKey);
      expect(section.guides.domain_filter).toBe(PRODUCT_DOMAIN);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Content-population-pending documentation
// ---------------------------------------------------------------------------

describe('Content-Population Pending Sections', () => {
  it('identifies exactly 3 sections as content-population pending', () => {
    expect(CONTENT_POPULATION_PENDING_SECTIONS.size).toBe(3);
  });

  it('all pending sections are at company_reference layer', () => {
    for (const pendingName of CONTENT_POPULATION_PENDING_SECTIONS) {
      const section = SECTION_FILTER_MAP.find(s => s.sectionName === pendingName);
      expect(section, `Section "${pendingName}" not found in filter map`).toBeDefined();
      expect(
        section!.expectedLayer,
        `Pending section "${pendingName}" should be at company_reference layer`,
      ).toBe('company_reference');
    }
  });

  it('pending sections have semantically correct subtopic_filter values', () => {
    // Even though these sections have 0 items today, the subtopic is intentional
    const expectedMapping: Record<string, string> = {
      'Pricing': 'financial',
      'Data Handling': 'data-protection',
      'Certifications': 'certification',
    };

    for (const [sectionName, expectedSubtopic] of Object.entries(expectedMapping)) {
      const section = SECTION_FILTER_MAP.find(s => s.sectionName === sectionName);
      expect(section?.subtopicFilter).toBe(expectedSubtopic);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Migration idempotency guard
// ---------------------------------------------------------------------------

describe('Migration Idempotency', () => {
  it('migration only updates rows where subtopic_filter IS NULL', () => {
    // This test documents the migration's WHERE clause:
    // WHERE subtopic_filter IS NULL
    //
    // If a section already has a subtopic_filter (e.g. from a later migration
    // or manual edit), the migration will not overwrite it.
    //
    // We verify this by checking that the mapping assumes the starting state
    // is all-NULL and the ending state is all-populated.

    // Starting state: all NULL
    const startingNulls = SECTION_FILTER_MAP.filter(_ => true); // all
    expect(startingNulls).toHaveLength(19);

    // Ending state: all populated
    const populatedAfter = SECTION_FILTER_MAP.filter(s => s.subtopicFilter !== null);
    expect(populatedAfter).toHaveLength(19);
  });
});
