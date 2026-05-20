/**
 * Content Suggestions Engine Tests
 *
 * Tests the generateContentSuggestions() engine for:
 *   - Empty subtopic detection
 *   - Thin coverage detection
 *   - Stale-only subtopic detection
 *   - Template gap detection
 *   - Priority ordering
 *   - Domain filtering
 *   - Active bid priority boost
 *   - Deduplication and limiting
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../helpers/mock-supabase';
// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

// ---------------------------------------------------------------------------
// Import after mock setup
// ---------------------------------------------------------------------------

const { generateContentSuggestions } =
  await import('@/lib/content/content-suggestions');

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

const DOMAINS = [
  { id: 'dom-1', name: 'Security', display_order: 1 },
  { id: 'dom-2', name: 'Compliance', display_order: 2 },
  { id: 'dom-3', name: 'Corporate', display_order: 3 },
];

const SUBTOPICS = [
  { id: 'sub-1', name: 'Certifications', domain_id: 'dom-1', display_order: 1 },
  { id: 'sub-2', name: 'Policies', domain_id: 'dom-1', display_order: 2 },
  { id: 'sub-3', name: 'ISO Standards', domain_id: 'dom-2', display_order: 1 },
  { id: 'sub-4', name: 'GDPR', domain_id: 'dom-2', display_order: 2 },
  {
    id: 'sub-5',
    name: 'Company History',
    domain_id: 'dom-3',
    display_order: 1,
  },
  { id: 'sub-6', name: 'Team', domain_id: 'dom-3', display_order: 2 },
];

function makeContentItem(
  domain: string,
  subtopic: string,
  freshness: string = 'fresh',
  contentType: string = 'article',
) {
  return {
    primary_domain: domain,
    primary_subtopic: subtopic,
    freshness,
    content_type: contentType,
  };
}

// ---------------------------------------------------------------------------
// Configure mock for each test
// ---------------------------------------------------------------------------

function configureMock(options: {
  contentItems?: Array<ReturnType<typeof makeContentItem>>;
  activeBids?: Array<{
    id: string;
    name: string;
    domain_metadata: Record<string, unknown> | null;
  }>;
  templateGaps?: Array<Record<string, unknown>>;
}) {
  const { contentItems = [], activeBids = [], templateGaps = [] } = options;

  // Reset all mocks
  mockSupabase.from.mockReset();
  mockSupabase._chain.select.mockReset();
  mockSupabase._chain.eq.mockReset();
  mockSupabase._chain.is.mockReset();
  mockSupabase._chain.order.mockReset();
  mockSupabase._chain.then.mockReset();

  // Build a table-based response system
  // Post-T2 (S246): table renamed from 'template_requirements' to
  // 'form_template_requirements' per the 3-tier form_type schema split.
  const tableResponses: Record<string, { data: unknown[]; error: null }> = {
    taxonomy_domains: { data: DOMAINS, error: null },
    taxonomy_subtopics: { data: SUBTOPICS, error: null },
    content_items: { data: contentItems, error: null },
    workspaces: { data: activeBids, error: null },
    form_template_requirements: { data: templateGaps, error: null },
  };

  // Create per-table chains
  mockSupabase.from.mockImplementation((table: string) => {
    const response = tableResponses[table] ?? { data: [], error: null };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: (v: unknown) => void) => resolve(response)),
    };
    return chain;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateContentSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty subtopic suggestions when no content exists', async () => {
    configureMock({ contentItems: [] });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
    });

    expect(result.length).toBeGreaterThan(0);

    // All suggestions should be empty_subtopic type
    const emptySubtopics = result.filter(
      (s) => s.suggestion_type === 'empty_subtopic',
    );
    expect(emptySubtopics.length).toBe(6); // All 6 subtopics are empty
    expect(emptySubtopics[0].item_count).toBe(0);
  });

  it('detects thin coverage (< 3 items)', async () => {
    configureMock({
      contentItems: [
        makeContentItem('Security', 'Certifications', 'fresh'),
        makeContentItem('Security', 'Certifications', 'aging'),
        // Only 2 items — should be thin
      ],
    });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
    });

    const thinSuggestions = result.filter(
      (s) => s.suggestion_type === 'thin_coverage',
    );
    expect(thinSuggestions.length).toBeGreaterThanOrEqual(1);

    const certsThin = thinSuggestions.find(
      (s) => s.domain === 'Security' && s.subtopic === 'Certifications',
    );
    expect(certsThin).toBeDefined();
    expect(certsThin!.item_count).toBe(2);
    expect(certsThin!.priority).toBe('medium');
  });

  it('detects stale-only subtopics', async () => {
    configureMock({
      contentItems: [
        makeContentItem('Security', 'Certifications', 'stale'),
        makeContentItem('Security', 'Certifications', 'expired'),
      ],
    });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
    });

    const staleSuggestions = result.filter(
      (s) => s.suggestion_type === 'stale_only',
    );
    expect(staleSuggestions.length).toBeGreaterThanOrEqual(1);

    const stale = staleSuggestions.find(
      (s) => s.domain === 'Security' && s.subtopic === 'Certifications',
    );
    expect(stale).toBeDefined();
    expect(stale!.priority).toBe('high');
    expect(stale!.freshness_breakdown).toEqual({
      fresh: 0,
      aging: 0,
      stale: 1,
      expired: 1,
    });
  });

  it('detects template gaps when includeTemplateGaps is true', async () => {
    configureMock({
      contentItems: [],
      templateGaps: [
        {
          template_name: 'Standard SQ',
          section_name: 'Health & Safety',
          requirement_text: 'Describe your health and safety policies',
          primary_domain: 'Compliance',
          primary_subtopic: 'ISO Standards',
        },
      ],
    });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
      includeTemplateGaps: true,
    });

    const templateGaps = result.filter(
      (s) => s.suggestion_type === 'template_gap',
    );
    expect(templateGaps.length).toBeGreaterThanOrEqual(1);
    expect(templateGaps[0].priority).toBe('high');
    expect(templateGaps[0].related_template).toBe('Standard SQ');
  });

  it('excludes template gaps when includeTemplateGaps is false', async () => {
    configureMock({
      contentItems: [],
      templateGaps: [
        {
          template_name: 'Standard SQ',
          section_name: 'Health & Safety',
          requirement_text: 'Describe your health and safety policies',
          primary_domain: 'Compliance',
          primary_subtopic: 'ISO Standards',
        },
      ],
    });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
      includeTemplateGaps: false,
    });

    const templateGaps = result.filter(
      (s) => s.suggestion_type === 'template_gap',
    );
    expect(templateGaps.length).toBe(0);
  });

  it('sorts suggestions by priority (critical before high before medium before low)', async () => {
    configureMock({
      contentItems: [
        // Stale-only in Security/Certifications -> high priority
        makeContentItem('Security', 'Certifications', 'stale'),
        makeContentItem('Security', 'Certifications', 'expired'),
        // Thin coverage in Security/Policies -> medium priority
        makeContentItem('Security', 'Policies', 'fresh'),
      ],
      activeBids: [
        // Active bid -> empty subtopics in bid domains become critical
        { id: 'bid-1', name: 'Test Procurement', domain_metadata: null },
      ],
    });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
    });

    // Check that critical comes before high, high before medium
    for (let i = 1; i < result.length; i++) {
      const prevOrder =
        { critical: 0, high: 1, medium: 2, low: 3 }[result[i - 1].priority] ??
        99;
      const currOrder =
        { critical: 0, high: 1, medium: 2, low: 3 }[result[i].priority] ?? 99;
      expect(prevOrder).toBeLessThanOrEqual(currOrder);
    }
  });

  it('applies domain filter correctly', async () => {
    configureMock({ contentItems: [] });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
      domainFilter: 'Security',
    });

    // Only Security domain suggestions should be returned
    for (const s of result) {
      expect(s.domain).toBe('Security');
    }
    // Should have 2 subtopics for Security
    expect(result.length).toBe(2);
  });

  it('respects maxSuggestions limit', async () => {
    configureMock({ contentItems: [] });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 3,
    });

    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('generates deterministic IDs', async () => {
    configureMock({ contentItems: [] });

    const result1 = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 5,
    });

    configureMock({ contentItems: [] });

    const result2 = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 5,
    });

    // Same inputs should produce same IDs
    expect(result1.map((s) => s.id)).toEqual(result2.map((s) => s.id));
  });

  it('does not produce duplicate IDs', async () => {
    configureMock({ contentItems: [] });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
    });

    const ids = result.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('skips subtopics with 3+ fresh items (no suggestion needed)', async () => {
    configureMock({
      contentItems: [
        makeContentItem('Security', 'Certifications', 'fresh'),
        makeContentItem('Security', 'Certifications', 'fresh'),
        makeContentItem('Security', 'Certifications', 'fresh'),
      ],
    });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
    });

    const certsSuggestions = result.filter(
      (s) => s.domain === 'Security' && s.subtopic === 'Certifications',
    );
    expect(certsSuggestions.length).toBe(0);
  });

  it('elevates empty subtopics to critical when active bids exist', async () => {
    configureMock({
      contentItems: [],
      activeBids: [{ id: 'bid-1', name: 'Active Procurement', domain_metadata: null }],
    });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
    });

    const emptySubtopics = result.filter(
      (s) => s.suggestion_type === 'empty_subtopic',
    );
    // When there are active bids, empty subtopics should be critical
    for (const s of emptySubtopics) {
      expect(s.priority).toBe('critical');
    }
  });

  it('includes freshness_breakdown for thin and stale suggestions', async () => {
    configureMock({
      contentItems: [
        makeContentItem('Security', 'Certifications', 'fresh'),
        makeContentItem('Security', 'Certifications', 'stale'),
      ],
    });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
    });

    const thinCerts = result.find(
      (s) => s.domain === 'Security' && s.subtopic === 'Certifications',
    );
    expect(thinCerts).toBeDefined();
    expect(thinCerts!.freshness_breakdown).toEqual({
      fresh: 1,
      aging: 0,
      stale: 1,
      expired: 0,
    });
  });

  it('returns empty array when all subtopics have good coverage', async () => {
    // Create 3+ items for every subtopic
    const items = SUBTOPICS.flatMap((st) => {
      const domain = DOMAINS.find((d) => d.id === st.domain_id)!;
      return [
        makeContentItem(domain.name, st.name, 'fresh'),
        makeContentItem(domain.name, st.name, 'fresh'),
        makeContentItem(domain.name, st.name, 'aging'),
      ];
    });

    configureMock({
      contentItems: items,
      templateGaps: [],
    });

    const result = await generateContentSuggestions({
      supabase: mockSupabase as unknown as Parameters<
        typeof generateContentSuggestions
      >[0]['supabase'],
      maxSuggestions: 20,
      includeTemplateGaps: false,
    });

    // No suggestions since everything has 3+ items with at least some fresh
    expect(result.length).toBe(0);
  });
});
