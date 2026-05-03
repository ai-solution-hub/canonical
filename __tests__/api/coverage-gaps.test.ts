/**
 * API route tests for GET /api/coverage/gaps.
 *
 * Verifies the unified gap endpoint correctly:
 * - Authenticates requests via getAuthorisedClient
 * - Fetches taxonomy, template, and guide gap data
 * - Scores and sorts gaps by priority
 * - Applies source, priority, domain filters
 * - Paginates via limit/offset
 * - Returns correct UnifiedGapSummary structure
 *
 * Spec: .planning/specs/gaps-view-consolidation-spec.md §6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const {
  mockCookies,
  mockListAvailableTemplates,
  mockFetchTemplateRequirements,
  mockComputeTemplateCoverage,
  mockFetchContentForMatching,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockListAvailableTemplates: vi.fn(),
  mockFetchTemplateRequirements: vi.fn(),
  mockComputeTemplateCoverage: vi.fn(),
  mockFetchContentForMatching: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/templates/template-coverage', () => ({
  listAvailableTemplates: mockListAvailableTemplates,
  fetchTemplateRequirements: mockFetchTemplateRequirements,
  computeTemplateCoverage: mockComputeTemplateCoverage,
  fetchContentForMatching: mockFetchContentForMatching,
}));

// Import route handler AFTER mocks are registered
const { GET, _clearCache } = await import('@/app/api/coverage/gaps/route');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MATRIX_DATA = [
  { domain_name: 'Engineering', subtopic_name: 'DevOps', item_count: 5 },
  { domain_name: 'Engineering', subtopic_name: 'Testing', item_count: 0 },
  { domain_name: 'Finance', subtopic_name: 'Budgets', item_count: 0 },
  { domain_name: 'Finance', subtopic_name: 'Reporting', item_count: 0 },
];

const TARGETS_DATA = [
  {
    id: 't1',
    domain_id: 'd1',
    metric_name: 'item_count',
    target_value: 5,
    taxonomy_domains: { name: 'Engineering' },
  },
];

const GUIDE_DATA = [
  {
    guide_id: 'g1',
    guide_name: 'ISO Guide',
    guide_slug: 'iso-guide',
    guide_type: 'standard',
    domain_filter: 'all',
    section_id: 's1',
    section_name: 'Introduction',
    section_order: 1,
    expected_layer: null,
    is_required: true,
    content_count: 0,
    fresh_count: 0,
    stale_count: 0,
  },
  {
    guide_id: 'g1',
    guide_name: 'ISO Guide',
    guide_slug: 'iso-guide',
    guide_type: 'standard',
    domain_filter: 'all',
    section_id: 's2',
    section_name: 'References',
    section_order: 2,
    expected_layer: null,
    is_required: false,
    content_count: 3,
    fresh_count: 0,
    stale_count: 3,
  },
  {
    guide_id: 'g1',
    guide_name: 'ISO Guide',
    guide_slug: 'iso-guide',
    guide_type: 'standard',
    domain_filter: 'all',
    section_id: 's3',
    section_name: 'Scope',
    section_order: 3,
    expected_layer: null,
    is_required: false,
    content_count: 5,
    fresh_count: 3,
    stale_count: 2,
  },
];

const TEMPLATE_COVERAGE_RESULT = {
  template_name: 'Standard SQ',
  template_version: '1.0',
  template_type: 'SQ',
  total_requirements: 3,
  strong_count: 1,
  partial_count: 0,
  gap_count: 2,
  na_count: 0,
  score: 0.333,
  sections: [
    {
      section_ref: '1.0',
      section_name: 'Company Details',
      requirements: [
        {
          requirement_id: 'req-1',
          requirement_text: 'Company registration number',
          requirement_type: 'data',
          coverage_status: 'strong',
          description: null,
          section_ref: '1.0',
          section_name: 'Company Details',
          question_number: 1,
          matching_content_ids: ['c1'],
          best_similarity_score: 0.8,
          content_length_met: true,
        },
      ],
    },
    {
      section_ref: '2.0',
      section_name: 'Health & Safety',
      requirements: [
        {
          requirement_id: 'req-2',
          requirement_text: 'Health and safety policy',
          requirement_type: 'policy',
          coverage_status: 'gap',
          description: 'Provide your H&S policy',
          section_ref: '2.0',
          section_name: 'Health & Safety',
          question_number: 1,
          matching_content_ids: [],
          best_similarity_score: 0,
          content_length_met: false,
        },
        {
          requirement_id: 'req-3',
          requirement_text: 'Environmental policy',
          requirement_type: 'policy',
          coverage_status: 'gap',
          description: null,
          section_ref: '2.0',
          section_name: 'Health & Safety',
          question_number: 2,
          matching_content_ids: [],
          best_similarity_score: 0,
          content_length_met: false,
        },
      ],
    },
  ],
};

const TEMPLATE_REQUIREMENTS = [
  { id: 'req-1', is_mandatory: false },
  { id: 'req-2', is_mandatory: true },
  { id: 'req-3', is_mandatory: null },
];

// ---------------------------------------------------------------------------
// Helper to set up default mocks
// ---------------------------------------------------------------------------

function setupDefaultMocks() {
  // Re-wire next/headers mock
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  // Re-wire Supabase auth
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  // Re-wire chain methods
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  const chainable = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'ilike',
    'contains',
    'gte',
    'lte',
    'gt',
    'lt',
    'or',
    'order',
    'limit',
    'range',
  ] as const;
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  // Terminal methods - role lookup for getAuthorisedClient
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({
    data: { role: 'viewer' },
    error: null,
  });

  // coverage_targets query (awaited as thenable)
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: TARGETS_DATA, error: null, count: TARGETS_DATA.length }),
  );

  // RPC mocks: first call = matrix, second = guide (run in Promise.all)
  mockSupabase.rpc.mockReset();
  mockSupabase.rpc
    .mockResolvedValueOnce({ data: MATRIX_DATA, error: null })
    .mockResolvedValueOnce({ data: GUIDE_DATA, error: null });

  // Template coverage mocks
  mockListAvailableTemplates.mockResolvedValue([
    {
      template_name: 'Standard SQ',
      template_version: '1.0',
      template_type: 'SQ',
      requirement_count: 3,
      is_current: true,
    },
  ]);
  mockFetchContentForMatching.mockResolvedValue([]);
  mockFetchTemplateRequirements.mockResolvedValue(TEMPLATE_REQUIREMENTS);
  mockComputeTemplateCoverage.mockReturnValue(TEMPLATE_COVERAGE_RESULT);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  _clearCache();
  setupDefaultMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/coverage/gaps', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 200 with unified gap summary on success', async () => {
    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('total_gaps');
    expect(body).toHaveProperty('taxonomy_gaps');
    expect(body).toHaveProperty('template_gaps');
    expect(body).toHaveProperty('guide_gaps');
    expect(body).toHaveProperty('critical');
    expect(body).toHaveProperty('high');
    expect(body).toHaveProperty('medium');
    expect(body).toHaveProperty('low');
    expect(body).toHaveProperty('gaps');
    expect(Array.isArray(body.gaps)).toBe(true);
  });

  it('includes taxonomy gaps from matrix rows with item_count = 0', async () => {
    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    const body = await res.json();

    const taxonomyGaps = body.gaps.filter(
      (g: { source: string }) => g.source === 'taxonomy',
    );
    // Engineering/Testing, Finance/Budgets, Finance/Reporting = 3 taxonomy gaps
    expect(taxonomyGaps.length).toBe(3);
    expect(body.taxonomy_gaps).toBe(3);
  });

  it('includes template gaps from coverage results', async () => {
    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    const body = await res.json();

    const templateGaps = body.gaps.filter(
      (g: { source: string }) => g.source === 'template',
    );
    // 2 gap requirements in the test data
    expect(templateGaps.length).toBe(2);
    expect(body.template_gaps).toBe(2);
  });

  it('includes guide gaps from sections with empty or stale status', async () => {
    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    const body = await res.json();

    const guideGaps = body.gaps.filter(
      (g: { source: string }) => g.source === 'guide',
    );
    // s1 is empty (content_count=0), s2 is stale (fresh=0, stale=3), s3 is populated
    expect(guideGaps.length).toBe(2);
    expect(body.guide_gaps).toBe(2);
  });

  it('sorts gaps by priority_score descending', async () => {
    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    const body = await res.json();

    const scores = body.gaps.map(
      (g: { priority_score: number }) => g.priority_score,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it('assigns correct priority tiers to gaps', async () => {
    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    const body = await res.json();

    for (const gap of body.gaps) {
      if (gap.priority_score >= 75) expect(gap.priority_tier).toBe('critical');
      else if (gap.priority_score >= 50) expect(gap.priority_tier).toBe('high');
      else if (gap.priority_score >= 25)
        expect(gap.priority_tier).toBe('medium');
      else expect(gap.priority_tier).toBe('low');
    }
  });

  it('correctly scores mandatory template gap (SQ type)', async () => {
    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    const body = await res.json();

    const mandatoryGap = body.gaps.find((g: { gap_key: string }) =>
      g.gap_key.includes('req-2'),
    );
    expect(mandatoryGap).toBeDefined();
    // 20 base + 15 mandatory + 10 SQ = 45
    expect(mandatoryGap.priority_score).toBe(45);
    expect(mandatoryGap.priority_tier).toBe('medium');
  });

  it('treats is_mandatory null as false in template gap scoring', async () => {
    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    const body = await res.json();

    const nullMandatoryGap = body.gaps.find((g: { gap_key: string }) =>
      g.gap_key.includes('req-3'),
    );
    expect(nullMandatoryGap).toBeDefined();
    // 20 base + 0 mandatory (null = false) + 10 SQ = 30
    expect(nullMandatoryGap.priority_score).toBe(30);
  });

  it('filters by source parameter', async () => {
    const req = createTestRequest('/api/coverage/gaps', {
      searchParams: { source: 'taxonomy' },
    });
    const res = await GET(req);
    const body = await res.json();

    // All returned gaps should be taxonomy
    expect(
      body.gaps.every((g: { source: string }) => g.source === 'taxonomy'),
    ).toBe(true);
    // But summary still shows all totals
    expect(body.total_gaps).toBeGreaterThan(body.gaps.length);
  });

  it('filters by priority parameter', async () => {
    const req = createTestRequest('/api/coverage/gaps', {
      searchParams: { priority: 'medium' },
    });
    const res = await GET(req);
    const body = await res.json();

    expect(
      body.gaps.every(
        (g: { priority_tier: string }) => g.priority_tier === 'medium',
      ),
    ).toBe(true);
  });

  it('filters by domain parameter', async () => {
    const req = createTestRequest('/api/coverage/gaps', {
      searchParams: { domain: 'Finance' },
    });
    const res = await GET(req);
    const body = await res.json();

    // Only Finance taxonomy gaps should remain (templates and guides have null domain)
    const domainsInResult = body.gaps
      .map((g: { domain: string | null }) => g.domain)
      .filter(Boolean);
    expect(domainsInResult.every((d: string) => d === 'Finance')).toBe(true);
  });

  it('applies pagination with limit and offset', async () => {
    const req = createTestRequest('/api/coverage/gaps', {
      searchParams: { limit: '2', offset: '0' },
    });
    const res = await GET(req);
    const body = await res.json();

    expect(body.gaps.length).toBeLessThanOrEqual(2);
    // total_gaps should still reflect all gaps
    expect(body.total_gaps).toBeGreaterThan(2);
  });

  it('returns 400 for invalid source parameter', async () => {
    const req = createTestRequest('/api/coverage/gaps', {
      searchParams: { source: 'invalid' },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid priority parameter', async () => {
    const req = createTestRequest('/api/coverage/gaps', {
      searchParams: { priority: 'urgent' },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns empty gap list when KB is fully covered', async () => {
    // Override: all matrix rows have content
    mockSupabase.rpc.mockReset();
    mockSupabase.rpc
      .mockResolvedValueOnce({
        data: [
          {
            domain_name: 'Engineering',
            subtopic_name: 'DevOps',
            item_count: 5,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null }); // No guide data

    // No templates
    mockListAvailableTemplates.mockReset();
    mockListAvailableTemplates.mockResolvedValue([]);

    // No coverage targets
    mockSupabase._chain.then.mockReset();
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );

    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    const body = await res.json();

    expect(body.total_gaps).toBe(0);
    expect(body.gaps).toEqual([]);
  });

  it('returns 500 when matrix RPC fails', async () => {
    mockSupabase.rpc.mockReset();
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error' },
    });

    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toContain('Failed to load taxonomy coverage data');
  });

  it('returns 500 when guide RPC fails', async () => {
    mockSupabase.rpc.mockReset();
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: MATRIX_DATA, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'Guide RPC error' },
      });

    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toContain('Failed to load guide coverage data');
  });

  it('handles no templates gracefully', async () => {
    mockListAvailableTemplates.mockReset();
    mockListAvailableTemplates.mockResolvedValue([]);

    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    const body = await res.json();

    expect(body.template_gaps).toBe(0);
    // Template-related functions should not be called
    expect(mockFetchContentForMatching).not.toHaveBeenCalled();
  });

  it('gap cards have correct action_href for each source', async () => {
    const req = createTestRequest('/api/coverage/gaps');
    const res = await GET(req);
    const body = await res.json();

    for (const gap of body.gaps) {
      switch (gap.source) {
        case 'taxonomy':
          expect(gap.action_href).toContain('/browse?');
          expect(gap.action_label).toBe('Add content');
          break;
        case 'template':
          expect(gap.action_href).toContain('/coverage?tab=templates');
          expect(gap.action_label).toBe('View requirement');
          break;
        case 'guide':
          expect(gap.action_href).toContain('/guide/');
          expect(gap.action_label).toBe('Open guide');
          break;
      }
    }
  });

  it('every gap has a unique gap_key', async () => {
    const req = createTestRequest('/api/coverage/gaps', {
      searchParams: { limit: '100' },
    });
    const res = await GET(req);
    const body = await res.json();

    const keys = body.gaps.map((g: { gap_key: string }) => g.gap_key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('clamps limit to max 100', async () => {
    const req = createTestRequest('/api/coverage/gaps', {
      searchParams: { limit: '200' },
    });
    const res = await GET(req);
    const body = await res.json();

    // Should return at most 100 (but we have fewer gaps in test data)
    expect(body.gaps.length).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Regression: S22 CI smoke surfaced React duplicate-key warning on Priority
// Gaps tab. The render site keys children on `gap.gap_key`. Duplicate keys
// can arise structurally from any of the three sources:
//   1. listAvailableTemplates returns multiple template_version entries for
//      the same template_name (each calling fetchTemplateRequirements with
//      only `template_name`, returning the SAME requirements N times).
//   2. get_coverage_matrix RPC returns duplicate (domain, subtopic) tuples.
//   3. get_guide_coverage RPC returns duplicate (guide_id, section_id) rows.
//
// The API response MUST de-duplicate by gap_key before returning, otherwise
// the React reconciler emits "Encountered two children with the same key".
//
// Spec context: docs/continuation-prompts/session-23.md (S23 W1 IMPL-D);
// offending UUID 21c0a9e8-e573-4e60-9a03-983c28102f67 (since-purged on
// staging-refresh; bug is structural so reproduced via mocked dup inputs).
// ---------------------------------------------------------------------------

describe('GET /api/coverage/gaps — duplicate-key regression', () => {
  it('de-duplicates template gaps when listAvailableTemplates returns the same template_name twice', async () => {
    // Simulate the structural dup mode: two template versions, both is_current,
    // both yielding the same set of requirements when fetched by template_name.
    mockListAvailableTemplates.mockReset();
    mockListAvailableTemplates.mockResolvedValue([
      {
        template_name: 'Standard SQ',
        template_version: '1.0',
        template_type: 'SQ',
        requirement_count: 3,
        is_current: true,
      },
      {
        template_name: 'Standard SQ',
        template_version: '1.1',
        template_type: 'SQ',
        requirement_count: 3,
        is_current: true,
      },
    ]);
    // fetchTemplateRequirements is keyed on template_name only, so both calls
    // return the same requirement set — emulates real prod behaviour.
    mockFetchTemplateRequirements.mockResolvedValue(TEMPLATE_REQUIREMENTS);
    // computeTemplateCoverage is called once per template entry; both produce
    // identical gap rows (same template_name, same section_ref, same req id).
    mockComputeTemplateCoverage.mockReturnValue(TEMPLATE_COVERAGE_RESULT);

    const req = createTestRequest('/api/coverage/gaps', {
      searchParams: { limit: '100' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    const keys = body.gaps.map((g: { gap_key: string }) => g.gap_key);
    const uniqueKeys = new Set(keys);

    // CRITICAL ASSERTION: every key in the response must be unique. Without
    // a de-dup pass, the duplicate template version produces two gap entries
    // per requirement → React warning at the render site.
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('de-duplicates taxonomy gaps when matrix RPC returns duplicate (domain, subtopic) rows', async () => {
    // Simulate matrix RPC returning the same empty-subtopic row twice (e.g. via
    // a JOIN cardinality bug in a future RPC change).
    mockSupabase.rpc.mockReset();
    mockSupabase.rpc
      .mockResolvedValueOnce({
        data: [
          {
            domain_name: 'Engineering',
            subtopic_name: 'Testing',
            item_count: 0,
          },
          {
            domain_name: 'Engineering',
            subtopic_name: 'Testing',
            item_count: 0,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null }); // empty guide

    mockListAvailableTemplates.mockReset();
    mockListAvailableTemplates.mockResolvedValue([]);

    const req = createTestRequest('/api/coverage/gaps', {
      searchParams: { limit: '100' },
    });
    const res = await GET(req);
    const body = await res.json();

    const keys = body.gaps.map((g: { gap_key: string }) => g.gap_key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('de-duplicates guide gaps when guide RPC returns duplicate (guide_id, section_id) rows', async () => {
    // Simulate guide RPC duplicating a section row (e.g. via a future GROUP BY
    // regression). Only sections with content_count=0 are emitted as gaps, so
    // the dup must be on a section that qualifies.
    mockSupabase.rpc.mockReset();
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: [], error: null }) // empty matrix
      .mockResolvedValueOnce({
        data: [
          {
            guide_id: 'g1',
            guide_name: 'ISO Guide',
            guide_slug: 'iso-guide',
            guide_type: 'standard',
            domain_filter: 'all',
            section_id: 's1',
            section_name: 'Introduction',
            section_order: 1,
            expected_layer: null,
            is_required: true,
            content_count: 0,
            fresh_count: 0,
            stale_count: 0,
          },
          {
            guide_id: 'g1',
            guide_name: 'ISO Guide',
            guide_slug: 'iso-guide',
            guide_type: 'standard',
            domain_filter: 'all',
            section_id: 's1',
            section_name: 'Introduction',
            section_order: 1,
            expected_layer: null,
            is_required: true,
            content_count: 0,
            fresh_count: 0,
            stale_count: 0,
          },
        ],
        error: null,
      });

    mockListAvailableTemplates.mockReset();
    mockListAvailableTemplates.mockResolvedValue([]);

    const req = createTestRequest('/api/coverage/gaps', {
      searchParams: { limit: '100' },
    });
    const res = await GET(req);
    const body = await res.json();

    const keys = body.gaps.map((g: { gap_key: string }) => g.gap_key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });
});
