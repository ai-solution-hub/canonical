import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const {
  mockCookies,
  mockCheckRateLimit,
  mockFetchUnifiedDashboardData,
  mockUnifiedToDashboardData,
  mockListAvailableTemplates,
  mockFetchTemplateRequirements,
  mockComputeTemplateCoverage,
  mockComputeGapSummary,
  mockFetchContentForMatching,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFetchUnifiedDashboardData: vi.fn(),
  mockUnifiedToDashboardData: vi.fn((d: unknown) => d),
  mockListAvailableTemplates: vi.fn(),
  mockFetchTemplateRequirements: vi.fn(),
  mockComputeTemplateCoverage: vi.fn(),
  mockComputeGapSummary: vi.fn(),
  mockFetchContentForMatching: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@/lib/dashboard', () => ({
  fetchUnifiedDashboardData: mockFetchUnifiedDashboardData,
  unifiedToDashboardData: mockUnifiedToDashboardData,
}));

vi.mock('@/lib/domains/procurement/form-templating/template-coverage', () => ({
  listAvailableTemplates: mockListAvailableTemplates,
  fetchTemplateRequirements: mockFetchTemplateRequirements,
  computeTemplateCoverage: mockComputeTemplateCoverage,
  computeGapSummary: mockComputeGapSummary,
  fetchContentForMatching: mockFetchContentForMatching,
}));

// Import route handlers AFTER mocks are registered
const { GET: coverageGet } = await import('@/app/api/coverage/route');
const { GET: templatesGet } =
  await import('@/app/api/coverage/templates/route');
const { GET: templatesListGet } =
  await import('@/app/api/coverage/templates/list/route');
const { GET: dashboardGet } = await import('@/app/api/dashboard/route');

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Re-wire next/headers mock
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  // Re-wire Supabase client mocks
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Chainable methods return the chain
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

  // Terminal methods
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.csv.mockReset();
  mockSupabase._chain.csv.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  // External dependency mocks
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  mockFetchUnifiedDashboardData.mockResolvedValue({
    needs_attention: {
      governance_review_count: 0,
      unverified_count: 0,
      quality_flag_count: 0,
      stale_content_count: 0,
      expired_content_count: 0,
    },
    active_bids: [],
    freshness_summary: {
      fresh: 10,
      aging: 2,
      stale: 1,
      expired: 0,
    },
    unread_notification_count: 0,
    recent_activity: [],
    user_role: 'viewer',
    errors: [],
  });
  mockListAvailableTemplates.mockResolvedValue([]);
  mockFetchTemplateRequirements.mockResolvedValue([]);
  mockComputeTemplateCoverage.mockReturnValue({
    template_name: 'test-template',
    template_version: '1.0',
    template_type: 'prequalification',
    total_requirements: 0,
    strong_count: 0,
    partial_count: 0,
    gap_count: 0,
    na_count: 0,
    score: 80,
    sections: [],
  });
  mockComputeGapSummary.mockReturnValue({
    total_gaps: 0,
    total_partial: 0,
    templates_assessed: 0,
    gaps_by_type: {},
    partial_by_type: {},
    gaps_by_template: [],
    top_gaps: [],
  });
  mockFetchContentForMatching.mockResolvedValue([]);
});

// =============================================================================
// GET /api/coverage
// =============================================================================

describe('GET /api/coverage', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/coverage');
    const res = await coverageGet(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 200 with matrix and summary data on success', async () => {
    const matrixData = [
      { domain: 'Engineering', subtopic: 'DevOps', count: 5 },
    ];
    const summaryData = [{ domain: 'Engineering', total: 10 }];

    mockSupabase.rpc
      .mockResolvedValueOnce({ data: matrixData, error: null })
      .mockResolvedValueOnce({ data: summaryData, error: null });

    const req = createTestRequest('/api/coverage');
    const res = await coverageGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.matrix).toEqual(matrixData);
    expect(body.summary).toEqual(summaryData);
  });

  it('returns coverage scoped to the requested layer', async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const req = createTestRequest('/api/coverage', {
      searchParams: { layer: 'brief' },
    });
    const res = await coverageGet(req);
    expect(res.status).toBe(200);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_coverage_matrix', {
      p_layer: 'brief',
    });
  });

  it('returns 500 when matrix RPC fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error' },
    });

    const req = createTestRequest('/api/coverage');
    const res = await coverageGet(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to load coverage data');
  });

  it('returns 500 when summary RPC fails', async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'Summary RPC error' },
      });

    const req = createTestRequest('/api/coverage');
    const res = await coverageGet(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to load coverage summary');
  });
});

// =============================================================================
// GET /api/coverage/templates
// =============================================================================

describe('GET /api/coverage/templates', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/coverage/templates', {
      searchParams: { template_name: 'saq-pqs' },
    });
    const res = await templatesGet(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when template_name param is missing', async () => {
    const req = createTestRequest('/api/coverage/templates');
    const res = await templatesGet(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 404 when no requirements found for template', async () => {
    mockFetchTemplateRequirements.mockResolvedValueOnce([]);
    mockFetchContentForMatching.mockResolvedValueOnce([]);

    const req = createTestRequest('/api/coverage/templates', {
      searchParams: { template_name: 'nonexistent' },
    });
    const res = await templatesGet(req);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain('nonexistent');
  });

  it('returns 200 with coverage result on success', async () => {
    const requirements = [
      {
        requirement_key: 'r1',
        template_version: '2.0',
        template_type: 'prequalification',
      },
    ];
    mockFetchTemplateRequirements.mockResolvedValueOnce(requirements);
    mockFetchContentForMatching.mockResolvedValueOnce([]);
    const coverageResult = {
      template_name: 'saq-pqs',
      template_version: '2.0',
      template_type: 'prequalification',
      total_requirements: 0,
      strong_count: 0,
      partial_count: 0,
      gap_count: 0,
      na_count: 0,
      score: 75,
      sections: [],
    };
    mockComputeTemplateCoverage.mockReturnValueOnce(coverageResult);

    const req = createTestRequest('/api/coverage/templates', {
      searchParams: { template_name: 'saq-pqs' },
    });
    const res = await templatesGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.template_name).toBe('saq-pqs');
    expect(body.score).toBe(75);
  });
});

// =============================================================================
// GET /api/coverage/templates/list
// =============================================================================

describe('GET /api/coverage/templates/list', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await templatesListGet();
    expect(res.status).toBe(401);
  });

  it('returns 200 with templates array on success', async () => {
    const templates = [
      {
        template_name: 'saq-pqs',
        template_version: '1.0',
        template_type: 'prequalification',
        requirement_count: 12,
        is_current: true,
      },
      {
        template_name: 'iso-9001',
        template_version: '2.0',
        template_type: 'certification',
        requirement_count: 8,
        is_current: false,
      },
    ];
    mockListAvailableTemplates.mockResolvedValueOnce(templates);

    const res = await templatesListGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.templates).toHaveLength(2);
    expect(body.templates[0].template_name).toBe('saq-pqs');
  });

  it('returns 200 with empty array when no templates exist', async () => {
    mockListAvailableTemplates.mockResolvedValueOnce([]);

    const res = await templatesListGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.templates).toEqual([]);
  });
});

// =============================================================================
// GET /api/dashboard
// =============================================================================

describe('GET /api/dashboard', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await dashboardGet();
    expect(res.status).toBe(401);
  });

  it('returns 200 with dashboard data on success', async () => {
    // configureRole for the role lookup inside the route
    configureRole(mockSupabase, 'admin');

    const dashboardData = {
      needs_attention: {
        governance_review_count: 2,
        unverified_count: 5,
        quality_flag_count: 1,
        stale_content_count: 3,
        expired_content_count: 0,
      },
      active_bids: [],
      freshness_summary: {
        fresh: 10,
        aging: 2,
        stale: 1,
        expired: 0,
      },
      unread_notification_count: 0,
      recent_activity: [],
      user_role: 'admin',
      errors: [],
    };
    mockFetchUnifiedDashboardData.mockResolvedValueOnce(dashboardData);

    const res = await dashboardGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.needs_attention.governance_review_count).toBe(2);
    expect(body.errors).toEqual([]);
  });

  it('treats admins as admin when fetching dashboard data', async () => {
    configureRole(mockSupabase, 'admin');

    await dashboardGet();

    expect(mockFetchUnifiedDashboardData).toHaveBeenCalledWith(
      mockSupabase,
      'test-user-id',
      true,
      'admin',
    );
  });

  it('treats viewers as non-admin when fetching dashboard data', async () => {
    configureRole(mockSupabase, 'viewer');

    await dashboardGet();

    expect(mockFetchUnifiedDashboardData).toHaveBeenCalledWith(
      mockSupabase,
      'test-user-id',
      false,
      'viewer',
    );
  });

  it('returns 500 when all 7+ queries fail (errors threshold)', async () => {
    configureRole(mockSupabase, 'admin');

    mockFetchUnifiedDashboardData.mockResolvedValueOnce({
      needs_attention: {
        governance_review_count: null,
        unverified_count: null,
        quality_flag_count: null,
        stale_content_count: null,
        expired_content_count: null,
      },
      active_bids: [],
      freshness_summary: {
        fresh: 0,
        ageing: 0,
        stale: 0,
        expired: 0,
        unknown: 0,
      },
      errors: [
        'query1',
        'query2',
        'query3',
        'query4',
        'query5',
        'query6',
        'query7',
      ],
    });

    const res = await dashboardGet();
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Dashboard data unavailable');
  });
});
