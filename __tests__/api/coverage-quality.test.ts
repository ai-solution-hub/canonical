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

vi.mock('@/lib/templates/template-coverage', () => ({
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
const { GET: qualityGet, PATCH: qualityPatch } =
  await import('@/app/api/quality/route');
const { GET: qualitySummaryGet } =
  await import('@/app/api/quality/summary/route');
const { GET: insightsGet } = await import('@/app/api/insights/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

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
      ageing: 2,
      stale: 1,
      expired: 0,
      unknown: 0,
    },
    errors: [],
  });
  mockListAvailableTemplates.mockResolvedValue([]);
  mockFetchTemplateRequirements.mockResolvedValue([]);
  mockComputeTemplateCoverage.mockReturnValue({
    template_name: 'test-template',
    coverage_percent: 80,
    requirements: [],
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

  it('passes layer param to get_coverage_matrix RPC', async () => {
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
      coverage_percent: 75,
      requirements: [],
    };
    mockComputeTemplateCoverage.mockReturnValueOnce(coverageResult);

    const req = createTestRequest('/api/coverage/templates', {
      searchParams: { template_name: 'saq-pqs' },
    });
    const res = await templatesGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.template_name).toBe('saq-pqs');
    expect(body.coverage_percent).toBe(75);
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
      },
      {
        template_name: 'iso-9001',
        template_version: '2.0',
        template_type: 'certification',
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
        ageing: 2,
        stale: 1,
        expired: 0,
        unknown: 0,
      },
      errors: [],
    };
    mockFetchUnifiedDashboardData.mockResolvedValueOnce(dashboardData);

    const res = await dashboardGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.needs_attention.governance_review_count).toBe(2);
    expect(body.errors).toEqual([]);
  });

  it('passes isAdmin=true when user has admin role', async () => {
    configureRole(mockSupabase, 'admin');

    await dashboardGet();

    expect(mockFetchUnifiedDashboardData).toHaveBeenCalledWith(
      mockSupabase,
      'test-user-id',
      true,
      'admin',
    );
  });

  it('passes isAdmin=false when user has viewer role', async () => {
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

// =============================================================================
// GET /api/quality
// =============================================================================

describe('GET /api/quality', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/quality');
    const res = await qualityGet(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 with paginated quality flags on success', async () => {
    const qualityItems = [
      {
        id: VALID_UUID,
        flag_type: 'missing_content',
        severity: 'high',
        resolved: false,
      },
    ];
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: qualityItems, error: null, count: 1 }),
    );

    const req = createTestRequest('/api/quality');
    const res = await qualityGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it('returns 400 when item_id is not a valid UUID', async () => {
    const req = createTestRequest('/api/quality', {
      searchParams: { item_id: 'not-a-uuid' },
    });
    const res = await qualityGet(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('applies filter params to query', async () => {
    const req = createTestRequest('/api/quality', {
      searchParams: {
        item_id: VALID_UUID,
        flag_type: 'duplicate',
        resolved: 'false',
        limit: '10',
        offset: '5',
      },
    });
    await qualityGet(req);

    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'content_item_id',
      VALID_UUID,
    );
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'flag_type',
      'duplicate',
    );
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('resolved', false);
  });

  it('returns 500 when Supabase query fails', async () => {
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error' }, count: 0 }),
    );

    const req = createTestRequest('/api/quality');
    const res = await qualityGet(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to fetch quality flags');
  });
});

// =============================================================================
// PATCH /api/quality
// =============================================================================

describe('PATCH /api/quality', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/quality', {
      method: 'PATCH',
      body: { flag_id: VALID_UUID },
    });
    const res = await qualityPatch(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user has viewer role (requires editor+)', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/quality', {
      method: 'PATCH',
      body: { flag_id: VALID_UUID },
    });
    const res = await qualityPatch(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 when flag_id is missing', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/quality', {
      method: 'PATCH',
      body: {},
    });
    const res = await qualityPatch(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 when flag_id is not a valid UUID', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/quality', {
      method: 'PATCH',
      body: { flag_id: 'not-a-uuid' },
    });
    const res = await qualityPatch(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 200 with resolved confirmation on success', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    const req = createTestRequest('/api/quality', {
      method: 'PATCH',
      body: { flag_id: VALID_UUID, resolution_notes: 'Fixed the issue' },
    });
    const res = await qualityPatch(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.resolved).toBe(true);
    expect(body.id).toBe(VALID_UUID);
  });

  it('returns 500 when Supabase update fails', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'DB error', code: '50000' },
    });

    const req = createTestRequest('/api/quality', {
      method: 'PATCH',
      body: { flag_id: VALID_UUID },
    });
    const res = await qualityPatch(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to resolve quality flag');
  });
});

// =============================================================================
// GET /api/quality/summary
// =============================================================================

describe('GET /api/quality/summary', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await qualitySummaryGet();
    expect(res.status).toBe(401);
  });

  it('returns 200 with aggregated quality counts on success', async () => {
    const rpcData = [
      { flag_type: 'duplicate', severity: 'high', open_count: 3 },
      { flag_type: 'missing_content', severity: 'medium', open_count: 5 },
    ];
    mockSupabase.rpc.mockResolvedValueOnce({ data: rpcData, error: null });

    const res = await qualitySummaryGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total_open).toBe(8);
    expect(body.by_type.duplicate).toBe(3);
    expect(body.by_type.missing_content).toBe(5);
    expect(body.details).toHaveLength(2);
  });

  it('returns 500 when RPC fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error' },
    });

    const res = await qualitySummaryGet();
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to fetch quality issue counts');
  });
});

// =============================================================================
// GET /api/insights
// =============================================================================

describe('GET /api/insights', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/insights');
    const res = await insightsGet(req);
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const req = createTestRequest('/api/insights');
    const res = await insightsGet(req);
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.error).toContain('Rate limit');
  });

  it('returns 200 with trends data by default', async () => {
    const trendsData = [{ domain: 'Engineering', count: 10, trend: 'up' }];
    mockSupabase.rpc.mockResolvedValueOnce({
      data: trendsData,
      error: null,
    });

    const req = createTestRequest('/api/insights');
    const res = await insightsGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.trends).toEqual(trendsData);
  });

  it('returns 400 when topic type is missing keyword param', async () => {
    const req = createTestRequest('/api/insights', {
      searchParams: { type: 'topic' },
    });
    const res = await insightsGet(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Missing keyword parameter');
  });

  it('returns 400 when author type is missing author param', async () => {
    const req = createTestRequest('/api/insights', {
      searchParams: { type: 'author' },
    });
    const res = await insightsGet(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Missing author parameter');
  });

  it('returns 400 for unknown insight type', async () => {
    const req = createTestRequest('/api/insights', {
      searchParams: { type: 'unknown' },
    });
    const res = await insightsGet(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 200 with gaps data', async () => {
    const gapsData = { uncovered_domains: ['Finance'] };
    mockSupabase.rpc.mockResolvedValueOnce({
      data: gapsData,
      error: null,
    });

    const req = createTestRequest('/api/insights', {
      searchParams: { type: 'gaps' },
    });
    const res = await insightsGet(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.gaps).toEqual(gapsData);
  });

  it('returns 500 when RPC fails for trends', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error' },
    });

    const req = createTestRequest('/api/insights', {
      searchParams: { type: 'trends' },
    });
    const res = await insightsGet(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to fetch trend analysis');
  });
});
