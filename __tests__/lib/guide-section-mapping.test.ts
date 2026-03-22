import { describe, it, expect, beforeEach } from 'vitest';
import {
  suggestGuideSections,
  type GuideSectionMatchInput,
  type GuideSectionMatch,
} from '@/lib/guide-section-mapping';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cast mock client for the suggestGuideSections function */
function asSupabase(mock: MockSupabaseClient) {
  return mock as unknown as Parameters<typeof suggestGuideSections>[0];
}

/** Default input matching the SCP Compliance domain */
function baseInput(
  overrides: Partial<GuideSectionMatchInput> = {},
): GuideSectionMatchInput {
  return {
    primaryDomain: 'Compliance',
    primarySubtopic: 'Certification',
    layer: 'bid_detail',
    contentType: 'q_a_pair',
    ...overrides,
  };
}

/** Helper to build a mock guide_sections row with joined guide data */
function mockSection(overrides: {
  id?: string;
  section_name?: string;
  subtopic_filter?: string | null;
  expected_layer?: string | null;
  content_type_filter?: string | null;
  display_order?: number;
  is_required?: boolean;
  guides?: {
    id?: string;
    name?: string;
    slug?: string;
    domain_filter?: string | null;
    display_order?: number;
    is_published?: boolean;
  };
}) {
  return {
    id: overrides.id ?? 'section-1',
    section_name: overrides.section_name ?? 'Security Section',
    subtopic_filter: overrides.subtopic_filter ?? null,
    expected_layer: overrides.expected_layer ?? null,
    content_type_filter: overrides.content_type_filter ?? null,
    display_order: overrides.display_order ?? 1,
    is_required: overrides.is_required ?? false,
    guides: {
      id: overrides.guides?.id ?? 'guide-1',
      name: overrides.guides?.name ?? 'SCP Sector Guide',
      slug: overrides.guides?.slug ?? 'scp-sector-guide',
      domain_filter: overrides.guides?.domain_filter ?? 'Compliance',
      display_order: overrides.guides?.display_order ?? 1,
      is_published: overrides.guides?.is_published ?? true,
    },
  };
}

/**
 * Configure the mock chain to return sections when awaited.
 * This simulates the `.from('guide_sections').select(...).eq(...).eq(...)` chain.
 */
function configureSectionResponse(
  client: MockSupabaseClient,
  sections: ReturnType<typeof mockSection>[],
) {
  client._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: sections, error: null }),
  );
}

// ---------------------------------------------------------------------------
// Exact match tests
// ---------------------------------------------------------------------------

describe('suggestGuideSections — exact matches', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('returns exact match when all non-NULL filters match', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: 'Certification',
        expected_layer: 'bid_detail',
        content_type_filter: 'q_a_pair',
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('exact');
    expect(results[0].sectionName).toBe('Security Section');
    expect(results[0].guideName).toBe('SCP Sector Guide');
    expect(results[0].guideSlug).toBe('scp-sector-guide');
    expect(results[0].matchReason).toContain('all filters match');
  });

  it('returns exact match when section has only some non-NULL filters and all match', async () => {
    // Section has subtopic filter but NULL layer and content_type
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: 'Certification',
        expected_layer: null,
        content_type_filter: null,
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('exact');
    expect(results[0].matchReason).toContain('all filters match');
    expect(results[0].matchReason).toContain('subtopic');
  });

  it('returns exact match (vacuously true) when section has all NULL filters', async () => {
    // Section accepts everything in the domain
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: null,
        expected_layer: null,
        content_type_filter: null,
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('exact');
    expect(results[0].matchReason).toContain('accepts all content in this domain');
  });
});

// ---------------------------------------------------------------------------
// Partial match tests
// ---------------------------------------------------------------------------

describe('suggestGuideSections — partial matches', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('returns partial match when subtopic matches but layer does not', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: 'Certification',
        expected_layer: 'company_reference', // Item has 'bid_detail'
        content_type_filter: null,
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('partial');
    expect(results[0].matchReason).toContain('matches subtopic');
    expect(results[0].matchReason).toContain('not layer');
  });

  it('returns partial match when layer matches but subtopic does not', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: 'Audits', // Item has 'Certification'
        expected_layer: 'bid_detail',
        content_type_filter: null,
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('partial');
    expect(results[0].matchReason).toContain('matches layer');
    expect(results[0].matchReason).toContain('not subtopic');
  });

  it('returns partial match when content type matches but subtopic and layer do not', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: 'Audits',
        expected_layer: 'company_reference',
        content_type_filter: 'q_a_pair', // matches
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('partial');
    expect(results[0].matchReason).toContain('matches content type');
  });
});

// ---------------------------------------------------------------------------
// Domain-only match tests
// ---------------------------------------------------------------------------

describe('suggestGuideSections — domain-only matches', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('returns domain_only when no non-NULL filters match', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: 'Audits',            // does not match 'Certification'
        expected_layer: 'company_reference',    // does not match 'bid_detail'
        content_type_filter: 'policy',          // does not match 'q_a_pair'
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('domain_only');
    expect(results[0].matchReason).toContain('Domain match');
    expect(results[0].matchReason).toContain('only domain matches');
  });

  it('returns domain_only when subtopic and layer both differ', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: 'KCSIE',
        expected_layer: 'research',
        content_type_filter: null,
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('domain_only');
  });
});

// ---------------------------------------------------------------------------
// NULL filter handling
// ---------------------------------------------------------------------------

describe('suggestGuideSections — NULL filter handling', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('treats NULL subtopic_filter as matching any subtopic', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: null,       // matches any
        expected_layer: 'bid_detail', // matches
        content_type_filter: null,   // matches any
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('exact');
  });

  it('treats NULL expected_layer as matching any layer', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: 'Certification', // matches
        expected_layer: null,              // matches any
        content_type_filter: 'q_a_pair',   // matches
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('exact');
  });

  it('treats NULL content_type_filter as matching any content type', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: 'Certification', // matches
        expected_layer: 'bid_detail',      // matches
        content_type_filter: null,         // matches any
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('exact');
  });

  it('section with all NULL filters is an exact match for any item in the domain', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: null,
        expected_layer: null,
        content_type_filter: null,
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput({ primarySubtopic: 'Anything', layer: 'any_layer', contentType: 'any_type' }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('exact');
  });
});

// ---------------------------------------------------------------------------
// No matches / empty results
// ---------------------------------------------------------------------------

describe('suggestGuideSections — no matches', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('returns empty array when no published guides exist', async () => {
    configureSectionResponse(mockClient, []);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toEqual([]);
  });

  it('returns empty array when query returns error', async () => {
    mockClient._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'Connection failed' } }),
    );

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toEqual([]);
  });

  it('returns empty array when primaryDomain is empty', async () => {
    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput({ primaryDomain: '' }),
    );

    expect(results).toEqual([]);
    // Should not even query the database
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('queries the correct table and passes domain filter', async () => {
    configureSectionResponse(mockClient, []);

    await suggestGuideSections(
      asSupabase(mockClient),
      baseInput({ primaryDomain: 'Technology' }),
    );

    expect(mockClient.from).toHaveBeenCalledWith('guide_sections');
    expect(mockClient._chain.select).toHaveBeenCalled();
    // The .eq calls are on the chain — verify they were called
    expect(mockClient._chain.eq).toHaveBeenCalledWith('guides.is_published', true);
    expect(mockClient._chain.eq).toHaveBeenCalledWith('guides.domain_filter', 'Technology');
  });
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

describe('suggestGuideSections — sorting', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('sorts exact matches before partial matches before domain_only', async () => {
    configureSectionResponse(mockClient, [
      // Domain-only match (subtopic and layer differ)
      mockSection({
        id: 'domain-only',
        section_name: 'Domain Only Section',
        subtopic_filter: 'KCSIE',
        expected_layer: 'research',
        content_type_filter: null,
        display_order: 1,
      }),
      // Partial match (subtopic matches, layer differs)
      mockSection({
        id: 'partial',
        section_name: 'Partial Section',
        subtopic_filter: 'Certification',
        expected_layer: 'company_reference',
        content_type_filter: null,
        display_order: 2,
      }),
      // Exact match (all non-NULL filters match)
      mockSection({
        id: 'exact',
        section_name: 'Exact Section',
        subtopic_filter: 'Certification',
        expected_layer: 'bid_detail',
        content_type_filter: null,
        display_order: 3,
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(3);
    expect(results[0].sectionId).toBe('exact');
    expect(results[0].matchStrength).toBe('exact');
    expect(results[1].sectionId).toBe('partial');
    expect(results[1].matchStrength).toBe('partial');
    expect(results[2].sectionId).toBe('domain-only');
    expect(results[2].matchStrength).toBe('domain_only');
  });

  it('sorts required sections before non-required within same match strength', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        id: 'not-required',
        section_name: 'Optional Section',
        subtopic_filter: 'Certification',
        expected_layer: 'bid_detail',
        is_required: false,
        display_order: 1,
        guides: { display_order: 1 },
      }),
      mockSection({
        id: 'required',
        section_name: 'Required Section',
        subtopic_filter: 'Certification',
        expected_layer: 'bid_detail',
        is_required: true,
        display_order: 2,
        guides: { display_order: 1 },
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(2);
    expect(results[0].sectionId).toBe('required');
    expect(results[0].isRequired).toBe(true);
    expect(results[1].sectionId).toBe('not-required');
    expect(results[1].isRequired).toBe(false);
  });

  it('sorts by guide display order then section display order', async () => {
    configureSectionResponse(mockClient, [
      // Guide B (display_order 2), section 1
      mockSection({
        id: 'guide-b-sec-1',
        section_name: 'Guide B Section 1',
        subtopic_filter: 'Certification',
        expected_layer: null,
        display_order: 1,
        guides: {
          id: 'guide-b',
          name: 'Guide B',
          slug: 'guide-b',
          display_order: 2,
        },
      }),
      // Guide A (display_order 1), section 2
      mockSection({
        id: 'guide-a-sec-2',
        section_name: 'Guide A Section 2',
        subtopic_filter: 'Certification',
        expected_layer: null,
        display_order: 2,
        guides: {
          id: 'guide-a',
          name: 'Guide A',
          slug: 'guide-a',
          display_order: 1,
        },
      }),
      // Guide A (display_order 1), section 1
      mockSection({
        id: 'guide-a-sec-1',
        section_name: 'Guide A Section 1',
        subtopic_filter: 'Certification',
        expected_layer: null,
        display_order: 1,
        guides: {
          id: 'guide-a',
          name: 'Guide A',
          slug: 'guide-a',
          display_order: 1,
        },
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(3);
    // Guide A sections first (lower display_order), then by section display_order
    expect(results[0].sectionId).toBe('guide-a-sec-1');
    expect(results[1].sectionId).toBe('guide-a-sec-2');
    // Guide B section last
    expect(results[2].sectionId).toBe('guide-b-sec-1');
  });
});

// ---------------------------------------------------------------------------
// Multiple guides
// ---------------------------------------------------------------------------

describe('suggestGuideSections — multiple guides', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('returns matches from multiple guides', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        id: 'section-guide-1',
        section_name: 'Compliance Section',
        subtopic_filter: 'Certification',
        expected_layer: 'bid_detail',
        guides: {
          id: 'guide-1',
          name: 'SCP Sector Guide',
          slug: 'scp-sector-guide',
          display_order: 1,
        },
      }),
      mockSection({
        id: 'section-guide-2',
        section_name: 'Cert Overview',
        subtopic_filter: 'Certification',
        expected_layer: null,
        guides: {
          id: 'guide-2',
          name: 'Audits Product Guide',
          slug: 'audits-product-guide',
          display_order: 2,
        },
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(2);
    // Both should be exact matches (all non-NULL filters match)
    expect(results.every((r) => r.matchStrength === 'exact')).toBe(true);
    // Should have different guide IDs
    const guideIds = results.map((r) => r.guideId);
    expect(guideIds).toContain('guide-1');
    expect(guideIds).toContain('guide-2');
  });

  it('limits results to 5 maximum', async () => {
    // Create 7 sections, all exact matches
    const sections = Array.from({ length: 7 }, (_, i) =>
      mockSection({
        id: `section-${i}`,
        section_name: `Section ${i}`,
        subtopic_filter: 'Certification',
        expected_layer: 'bid_detail',
        display_order: i,
        guides: { display_order: 1 },
      }),
    );

    configureSectionResponse(mockClient, sections);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Content type filter matching
// ---------------------------------------------------------------------------

describe('suggestGuideSections — content type filter', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('matches when content type filter equals item content type', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: null,
        expected_layer: null,
        content_type_filter: 'q_a_pair',
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput({ contentType: 'q_a_pair' }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('exact');
  });

  it('does not match when content type filter differs from item content type', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: null,
        expected_layer: null,
        content_type_filter: 'policy', // item has 'q_a_pair'
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput({ contentType: 'q_a_pair' }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].matchStrength).toBe('domain_only');
  });

  it('handles missing contentType in input — non-NULL filter does not match', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: 'Certification',
        expected_layer: 'bid_detail',
        content_type_filter: 'q_a_pair', // item has no content type
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput({ contentType: undefined }),
    );

    expect(results).toHaveLength(1);
    // Subtopic and layer match, but content_type does not (undefined != 'q_a_pair')
    expect(results[0].matchStrength).toBe('partial');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('suggestGuideSections — edge cases', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('handles missing layer in input gracefully', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        subtopic_filter: 'Certification',
        expected_layer: 'bid_detail',
        content_type_filter: null,
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput({ layer: undefined }),
    );

    expect(results).toHaveLength(1);
    // Layer filter 'bid_detail' does not match undefined (coerced to '')
    expect(results[0].matchStrength).toBe('partial');
  });

  it('returns GuideSectionMatch with correct shape', async () => {
    configureSectionResponse(mockClient, [
      mockSection({
        id: 'sec-uuid-1',
        section_name: 'Test Section',
        subtopic_filter: 'Certification',
        expected_layer: 'bid_detail',
        content_type_filter: 'q_a_pair',
        display_order: 3,
        is_required: true,
        guides: {
          id: 'guide-uuid-1',
          name: 'My Guide',
          slug: 'my-guide',
          display_order: 2,
        },
      }),
    ]);

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    expect(results).toHaveLength(1);
    const match: GuideSectionMatch = results[0];
    expect(match.guideId).toBe('guide-uuid-1');
    expect(match.guideName).toBe('My Guide');
    expect(match.guideSlug).toBe('my-guide');
    expect(match.sectionId).toBe('sec-uuid-1');
    expect(match.sectionName).toBe('Test Section');
    expect(match.sectionOrder).toBe(3);
    expect(match.isRequired).toBe(true);
    expect(match.matchStrength).toBe('exact');
    expect(typeof match.matchReason).toBe('string');
    // Should not have internal guideDisplayOrder property
    expect('guideDisplayOrder' in match).toBe(false);
  });

  it('handles null guides relation gracefully', async () => {
    // Edge case: section with null guide (should not happen in practice)
    mockClient._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: 'orphan-section',
              section_name: 'Orphan',
              subtopic_filter: null,
              expected_layer: null,
              content_type_filter: null,
              display_order: 1,
              is_required: false,
              guides: null,
            },
          ],
          error: null,
        }),
    );

    const results = await suggestGuideSections(
      asSupabase(mockClient),
      baseInput(),
    );

    // Should skip the section with null guide
    expect(results).toEqual([]);
  });
});
