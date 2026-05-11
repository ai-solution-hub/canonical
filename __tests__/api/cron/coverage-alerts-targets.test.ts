/**
 * Tests for coverage-alerts cron — per-domain target-based alert thresholds.
 *
 * Verifies:
 *   - Alerts generated when freshness drops below fresh_pct target
 *   - Alerts generated when expired exceeds max_expired target
 *   - Alerts generated when item count below item_count target
 *   - No alerts when all targets are met
 *   - Existing hardcoded checks still work for domains without targets
 *   - Idempotency — no duplicates within same week
 *   - Handles empty targets gracefully
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../../helpers/mock-supabase';
import { createMockCronRequest } from '../../helpers/factories/cron-request';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}));

const { mockVerifyCronAuth, mockGetUsersByRole } = vi.hoisted(() => ({
  mockVerifyCronAuth: vi.fn(),
  mockGetUsersByRole: vi.fn(),
}));

vi.mock('@/lib/cron-auth', () => ({
  verifyCronAuth: mockVerifyCronAuth,
  getUsersByRole: mockGetUsersByRole,
}));

const { mockCreateBulkNotifications, mockGetExistingNotificationIds } =
  vi.hoisted(() => ({
    mockCreateBulkNotifications: vi.fn(),
    mockGetExistingNotificationIds: vi.fn(),
  }));

vi.mock('@/lib/notifications', () => ({
  createBulkNotifications: mockCreateBulkNotifications,
  getExistingNotificationIds: mockGetExistingNotificationIds,
}));

vi.mock('@/lib/error', () => ({
  safeErrorMessage: vi.fn((err: unknown, fallback: string) => {
    if (err instanceof Error) return err.message;
    return fallback;
  }),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

// Import handler AFTER mocks
import { GET } from '@/app/api/cron/coverage-alerts/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_ID_1 = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID_2 = '00000000-0000-4000-8000-000000000002';

interface CoverageSummaryRow {
  domain_name: string;
  domain_colour: string | null;
  total_items: number;
  fresh_pct: number;
  gap_count: number;
  expired_count: number;
}

interface CoverageTargetRow {
  domain_id: string;
  metric_name: string;
  target_value: number;
  taxonomy_domains: { name: string } | null;
}

function resetMocks() {
  vi.clearAllMocks();

  mockVerifyCronAuth.mockReturnValue(true);
  mockGetUsersByRole.mockResolvedValue([ADMIN_ID_1, ADMIN_ID_2]);
  mockCreateBulkNotifications.mockResolvedValue({ count: 0, error: null });
  mockGetExistingNotificationIds.mockResolvedValue(new Set());
}

/**
 * Configure the mock Supabase client for coverage-alerts cron.
 *
 * The route makes these calls:
 *   1. rpc('get_coverage_summary')  -> coverage rows
 *   2. from('coverage_targets').select(...).order(...) -> target rows
 *   3. from('pipeline_runs').select(...).eq(...).eq(...).order(...).limit(...).maybeSingle() -> previous snapshot
 *   4. from('notifications').select('title').eq(...).gte(...) -> existing titles for idempotency
 *   5. from('pipeline_runs').insert(...) -> store snapshot
 */
function configureMock(options: {
  coverage: CoverageSummaryRow[];
  targets?: CoverageTargetRow[];
  previousSnapshot?: Record<string, unknown> | null;
  existingTitles?: string[];
}) {
  const {
    coverage,
    targets = [],
    previousSnapshot = null,
    existingTitles = [],
  } = options;

  // rpc('get_coverage_summary')
  mockSupabase.rpc.mockResolvedValue({ data: coverage, error: null });

  // Track insert calls for pipeline_runs
  const insertCalls: Array<{ table: string; data: Record<string, unknown> }> =
    [];

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'coverage_targets') {
      return {
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            then: vi.fn((resolve: (v: unknown) => void) =>
              resolve({ data: targets, error: null }),
            ),
          }),
        }),
      };
    }

    if (table === 'pipeline_runs') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: previousSnapshot
                      ? { result: previousSnapshot }
                      : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
        insert: vi.fn().mockImplementation((data: Record<string, unknown>) => {
          insertCalls.push({ table, data });
          return {
            then: vi.fn((resolve: (v: unknown) => void) =>
              resolve({ data: null, error: null }),
            ),
          };
        }),
      };
    }

    if (table === 'notifications') {
      const titleResultObj = {
        then: vi.fn((resolve: (v: unknown) => void) =>
          resolve({
            data: existingTitles.map((t) => ({ title: t })),
            error: null,
          }),
        ),
      };
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue(titleResultObj),
          }),
        }),
      };
    }

    // Default fallback
    return mockSupabase._chain;
  });

  return { insertCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/coverage-alerts — target-based thresholds', () => {
  beforeEach(resetMocks);

  it('generates alert when freshness drops below fresh_pct target', async () => {
    configureMock({
      coverage: [
        {
          domain_name: 'Operations',
          domain_colour: null,
          total_items: 50,
          fresh_pct: 40,
          gap_count: 0,
          expired_count: 5,
        },
      ],
      targets: [
        {
          domain_id: 'dom-1',
          metric_name: 'fresh_pct',
          target_value: 60,
          taxonomy_domains: { name: 'Operations' },
        },
      ],
      previousSnapshot: {
        Operations: {
          total_items: 50,
          fresh_pct: 65,
          gap_count: 0,
          expired_count: 3,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.target_breaches).toBe(1);

    // Verify the notification was created with correct title format
    expect(mockCreateBulkNotifications).toHaveBeenCalled();
    const notifications = mockCreateBulkNotifications.mock
      .calls[0][1] as Array<{
      title: string;
      entityType: string;
      type: string;
    }>;

    const targetAlert = notifications.find((n) =>
      n.title.includes('freshness 40% below 60% target'),
    );
    expect(targetAlert).toBeDefined();
    expect(targetAlert!.entityType).toBe('domain');
    expect(targetAlert!.type).toBe('coverage_alert');
  });

  it('generates alert when expired exceeds max_expired target', async () => {
    configureMock({
      coverage: [
        {
          domain_name: 'Compliance',
          domain_colour: null,
          total_items: 30,
          fresh_pct: 80,
          gap_count: 0,
          expired_count: 8,
        },
      ],
      targets: [
        {
          domain_id: 'dom-2',
          metric_name: 'max_expired',
          target_value: 5,
          taxonomy_domains: { name: 'Compliance' },
        },
      ],
      previousSnapshot: {
        Compliance: {
          total_items: 30,
          fresh_pct: 85,
          gap_count: 0,
          expired_count: 3,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.target_breaches).toBe(1);

    expect(mockCreateBulkNotifications).toHaveBeenCalled();
    const notifications = mockCreateBulkNotifications.mock
      .calls[0][1] as Array<{
      title: string;
    }>;

    const targetAlert = notifications.find((n) =>
      n.title.includes('8 expired items (target: max 5)'),
    );
    expect(targetAlert).toBeDefined();
  });

  it('generates alert when item count below item_count target', async () => {
    configureMock({
      coverage: [
        {
          domain_name: 'Safety',
          domain_colour: null,
          total_items: 8,
          fresh_pct: 90,
          gap_count: 0,
          expired_count: 0,
        },
      ],
      targets: [
        {
          domain_id: 'dom-3',
          metric_name: 'item_count',
          target_value: 20,
          taxonomy_domains: { name: 'Safety' },
        },
      ],
      previousSnapshot: {
        Safety: {
          total_items: 8,
          fresh_pct: 90,
          gap_count: 0,
          expired_count: 0,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.target_breaches).toBe(1);

    expect(mockCreateBulkNotifications).toHaveBeenCalled();
    const notifications = mockCreateBulkNotifications.mock
      .calls[0][1] as Array<{
      title: string;
    }>;

    const targetAlert = notifications.find((n) =>
      n.title.includes('8 items, target is 20'),
    );
    expect(targetAlert).toBeDefined();
  });

  it('generates no target alerts when all targets are met', async () => {
    configureMock({
      coverage: [
        {
          domain_name: 'Operations',
          domain_colour: null,
          total_items: 50,
          fresh_pct: 80,
          gap_count: 0,
          expired_count: 2,
        },
      ],
      targets: [
        {
          domain_id: 'dom-1',
          metric_name: 'fresh_pct',
          target_value: 60,
          taxonomy_domains: { name: 'Operations' },
        },
        {
          domain_id: 'dom-1',
          metric_name: 'max_expired',
          target_value: 5,
          taxonomy_domains: { name: 'Operations' },
        },
        {
          domain_id: 'dom-1',
          metric_name: 'item_count',
          target_value: 30,
          taxonomy_domains: { name: 'Operations' },
        },
      ],
      previousSnapshot: {
        Operations: {
          total_items: 50,
          fresh_pct: 80,
          gap_count: 0,
          expired_count: 2,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.target_breaches).toBe(0);
    expect(body.critical_gaps).toBe(0);
    expect(body.degraded_domains).toBe(0);
    expect(body.notifications_created).toBe(0);
  });

  it('existing hardcoded checks still work for domains without targets', async () => {
    configureMock({
      coverage: [
        {
          domain_name: 'Finance',
          domain_colour: null,
          total_items: 20,
          fresh_pct: 0,
          gap_count: 3,
          expired_count: 15,
        },
      ],
      targets: [], // No targets configured
      previousSnapshot: {
        Finance: {
          total_items: 20,
          fresh_pct: 50,
          gap_count: 1,
          expired_count: 5,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Zero fresh content triggers critical gap
    expect(body.critical_gaps).toBe(1);
    // 50% to 0% = 50% drop triggers degradation
    expect(body.degraded_domains).toBe(1);
    expect(body.target_breaches).toBe(0);
    expect(body.empty_subtopics).toBe(3);
  });

  it('idempotency — no duplicates within same week', async () => {
    const existingTitle = 'Operations: freshness 40% below 60% target';

    configureMock({
      coverage: [
        {
          domain_name: 'Operations',
          domain_colour: null,
          total_items: 50,
          fresh_pct: 40,
          gap_count: 0,
          expired_count: 5,
        },
      ],
      targets: [
        {
          domain_id: 'dom-1',
          metric_name: 'fresh_pct',
          target_value: 60,
          taxonomy_domains: { name: 'Operations' },
        },
      ],
      // Previous fresh_pct is 50 — drop of 10 points, below the 20-point
      // degradation threshold so no hardcoded alert fires.
      previousSnapshot: {
        Operations: {
          total_items: 50,
          fresh_pct: 50,
          gap_count: 0,
          expired_count: 3,
        },
      },
      existingTitles: [existingTitle],
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Target breach detected but not notified due to idempotency
    expect(body.target_breaches).toBe(1);
    expect(body.notifications_created).toBe(0);
  });

  it('handles empty targets gracefully', async () => {
    configureMock({
      coverage: [
        {
          domain_name: 'Operations',
          domain_colour: null,
          total_items: 50,
          fresh_pct: 80,
          gap_count: 0,
          expired_count: 2,
        },
      ],
      targets: [],
      previousSnapshot: {
        Operations: {
          total_items: 50,
          fresh_pct: 80,
          gap_count: 0,
          expired_count: 2,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.target_breaches).toBe(0);
    expect(body.notifications_created).toBe(0);
    expect(body.snapshot_stored).toBe(true);
  });

  it('generates multiple target alerts for the same domain', async () => {
    configureMock({
      coverage: [
        {
          domain_name: 'Operations',
          domain_colour: null,
          total_items: 5,
          fresh_pct: 30,
          gap_count: 0,
          expired_count: 10,
        },
      ],
      targets: [
        {
          domain_id: 'dom-1',
          metric_name: 'fresh_pct',
          target_value: 60,
          taxonomy_domains: { name: 'Operations' },
        },
        {
          domain_id: 'dom-1',
          metric_name: 'max_expired',
          target_value: 5,
          taxonomy_domains: { name: 'Operations' },
        },
        {
          domain_id: 'dom-1',
          metric_name: 'item_count',
          target_value: 20,
          taxonomy_domains: { name: 'Operations' },
        },
      ],
      previousSnapshot: {
        Operations: {
          total_items: 5,
          fresh_pct: 30,
          gap_count: 0,
          expired_count: 10,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    // All three targets breached
    expect(body.target_breaches).toBe(3);
  });

  it('skips targets for domains with missing taxonomy_domains name', async () => {
    configureMock({
      coverage: [
        {
          domain_name: 'Operations',
          domain_colour: null,
          total_items: 5,
          fresh_pct: 30,
          gap_count: 0,
          expired_count: 0,
        },
      ],
      targets: [
        {
          domain_id: 'dom-orphan',
          metric_name: 'fresh_pct',
          target_value: 60,
          taxonomy_domains: null, // Orphaned target with no domain name
        },
      ],
      previousSnapshot: {
        Operations: {
          total_items: 5,
          fresh_pct: 30,
          gap_count: 0,
          expired_count: 0,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    // No target breach because the orphaned target is skipped
    expect(body.target_breaches).toBe(0);
  });

  it('stores target_breaches count in pipeline_runs snapshot', async () => {
    const { insertCalls } = configureMock({
      coverage: [
        {
          domain_name: 'Operations',
          domain_colour: null,
          total_items: 50,
          fresh_pct: 40,
          gap_count: 0,
          expired_count: 5,
        },
      ],
      targets: [
        {
          domain_id: 'dom-1',
          metric_name: 'fresh_pct',
          target_value: 60,
          taxonomy_domains: { name: 'Operations' },
        },
      ],
      previousSnapshot: {
        Operations: {
          total_items: 50,
          fresh_pct: 65,
          gap_count: 0,
          expired_count: 3,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    // pipeline_runs insert should include target_breaches
    const pipelineInserts = insertCalls.filter(
      (c) => c.table === 'pipeline_runs',
    );
    expect(pipelineInserts.length).toBe(1);
    const result = pipelineInserts[0].data.result as Record<string, unknown>;
    expect(result.target_breaches).toBe(1);
  });

  it('does not fire expired target alert when expired equals max_expired', async () => {
    configureMock({
      coverage: [
        {
          domain_name: 'Compliance',
          domain_colour: null,
          total_items: 30,
          fresh_pct: 80,
          gap_count: 0,
          expired_count: 5,
        },
      ],
      targets: [
        {
          domain_id: 'dom-2',
          metric_name: 'max_expired',
          target_value: 5, // Exactly at target — should NOT trigger
          taxonomy_domains: { name: 'Compliance' },
        },
      ],
      previousSnapshot: {
        Compliance: {
          total_items: 30,
          fresh_pct: 80,
          gap_count: 0,
          expired_count: 5,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.target_breaches).toBe(0);
  });

  it('does not fire item_count alert when items equal target', async () => {
    configureMock({
      coverage: [
        {
          domain_name: 'Safety',
          domain_colour: null,
          total_items: 20,
          fresh_pct: 90,
          gap_count: 0,
          expired_count: 0,
        },
      ],
      targets: [
        {
          domain_id: 'dom-3',
          metric_name: 'item_count',
          target_value: 20, // Exactly at target — should NOT trigger
          taxonomy_domains: { name: 'Safety' },
        },
      ],
      previousSnapshot: {
        Safety: {
          total_items: 20,
          fresh_pct: 90,
          gap_count: 0,
          expired_count: 0,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.target_breaches).toBe(0);
  });

  it('does not fire fresh_pct alert when freshness equals target', async () => {
    configureMock({
      coverage: [
        {
          domain_name: 'Operations',
          domain_colour: null,
          total_items: 50,
          fresh_pct: 60,
          gap_count: 0,
          expired_count: 2,
        },
      ],
      targets: [
        {
          domain_id: 'dom-1',
          metric_name: 'fresh_pct',
          target_value: 60, // Exactly at target — should NOT trigger
          taxonomy_domains: { name: 'Operations' },
        },
      ],
      previousSnapshot: {
        Operations: {
          total_items: 50,
          fresh_pct: 65,
          gap_count: 0,
          expired_count: 2,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.target_breaches).toBe(0);
  });

  it('target alerts coexist with hardcoded alerts for the same domain', async () => {
    // Domain has zero fresh content (hardcoded critical gap)
    // AND a max_expired target breach
    configureMock({
      coverage: [
        {
          domain_name: 'Operations',
          domain_colour: null,
          total_items: 20,
          fresh_pct: 0,
          gap_count: 0,
          expired_count: 15,
        },
      ],
      targets: [
        {
          domain_id: 'dom-1',
          metric_name: 'max_expired',
          target_value: 5,
          taxonomy_domains: { name: 'Operations' },
        },
        {
          domain_id: 'dom-1',
          metric_name: 'fresh_pct',
          target_value: 50,
          taxonomy_domains: { name: 'Operations' },
        },
      ],
      previousSnapshot: {
        Operations: {
          total_items: 20,
          fresh_pct: 50,
          gap_count: 0,
          expired_count: 5,
        },
      },
    });

    const res = await GET(createMockCronRequest({ path: '/api/cron/coverage-alerts' }) as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Hardcoded: critical gap + degradation (50% -> 0%)
    expect(body.critical_gaps).toBe(1);
    expect(body.degraded_domains).toBe(1);
    // Targets: both fresh_pct and max_expired breached
    expect(body.target_breaches).toBe(2);
  });
});
