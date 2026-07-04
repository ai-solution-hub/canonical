/**
 * Tests for the freshness-transitions cron route.
 *
 * Verifies:
 *   - Cron auth verification
 *   - Freshness transition detection and notification creation
 *   - Governance bridge: auto-flag on stale/expired transitions
 *   - No auto-flag on aging transitions (notification only)
 *   - Guard: skip items already in pending/changes_requested/draft
 *   - Cooldown: skip items verified within cooldown days
 *   - Batch summary when >20 items governance-flagged
 *   - Pipeline run logging with auto_governance_triggered count
 *   - Auto-flag disabled per domain
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
vi.spyOn(console, 'warn').mockImplementation(() => {});

// Import handler AFTER mocks
import { GET } from '@/app/api/cron/freshness-transitions/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_ID_1 = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID_2 = '00000000-0000-4000-8000-000000000002';
const REVIEWER_ID = '00000000-0000-4000-8000-000000000099';
const GOV_CONFIG_ID = '00000000-0000-4000-8000-000000000050';

type FreshnessState = 'fresh' | 'aging' | 'stale' | 'expired';

/**
 * Builds a record_lifecycle-facet-joined-to-source_documents row, matching
 * the shape `app/api/cron/freshness-transitions/route.ts` now reads (ID-131
 * {131.19}). Keeps the same override-parameter surface as the old
 * content_items-shaped factory so existing call sites don't need touching.
 */
function makeTransitionItem(
  overrides: Partial<{
    id: string;
    title: string;
    previous_freshness: FreshnessState;
    freshness: FreshnessState;
    primary_domain: string | null;
    updated_at: string | null;
    lifecycle_type: string | null;
    content_owner_id: string | null;
    governance_review_status: string | null;
    verified_at: string | null;
  }> = {},
) {
  const id = overrides.id ?? '00000000-0000-4000-8000-000000000010';
  return {
    // Convenience alias for test assertions (the route reads
    // source_document_id, never a bare `id` on this joined row).
    id,
    source_document_id: id,
    previous_freshness: overrides.previous_freshness ?? 'aging',
    freshness: overrides.freshness ?? 'stale',
    lifecycle_type: overrides.lifecycle_type ?? 'standard',
    content_owner_id: overrides.content_owner_id ?? null,
    governance_review_status: overrides.governance_review_status ?? null,
    verified_at: overrides.verified_at ?? null,
    source_documents: {
      id,
      filename: 'test-item.pdf',
      suggested_title: overrides.title ?? 'Test Item',
      primary_domain: overrides.primary_domain ?? 'Operations',
      updated_at: overrides.updated_at ?? '2026-01-01T00:00:00Z',
    },
  };
}

function resetMocks() {
  vi.clearAllMocks();

  mockVerifyCronAuth.mockReturnValue(true);
  // First call is for ['admin', 'editor'], second for ['admin']
  mockGetUsersByRole.mockImplementation(
    (_supabase: unknown, roles: string[]) => {
      if (roles.includes('editor')) {
        return Promise.resolve([ADMIN_ID_1, ADMIN_ID_2]);
      }
      return Promise.resolve([ADMIN_ID_1, ADMIN_ID_2]);
    },
  );
  mockCreateBulkNotifications.mockResolvedValue({ count: 0, error: null });
  mockGetExistingNotificationIds.mockResolvedValue(new Set());

  // Configure chain defaults
  const chainableMethods = [
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
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
}

/**
 * Configure sequential .from() calls.
 * ID-131 {131.19} G-GOV-FACET: content_items is dying — the
 * freshness-transitions cron now calls:
 *   1. from('governance_config').select(...)               -> govConfigs
 *   2. from('record_lifecycle').select(...).eq('owner_kind',...)
 *      .not('previous_freshness',...).neq('freshness','fresh')
 *                                                           -> transition items (facet+SD join)
 *   3. from('record_lifecycle').update(...).eq('owner_kind',...)
 *      .eq('source_document_id',...)                       -> governance status updates
 *   4. from('record_lifecycle').select(...).eq('owner_kind',...)
 *      .not('expiry_date',...).lte('expiry_date',...).is('source_documents.archived_at',...)
 *                                                           -> expiry reminders (unused by these
 *                                                              tests — defaults to empty)
 *   5. from('pipeline_runs').insert(...)                    -> logging
 *   6. Various notification-related calls
 */
function configureDetailedMock(options: {
  govConfigs?: Array<{
    domain: string;
    id?: string;
    auto_flag_on_freshness_transition?: boolean | null;
    auto_flag_cooldown_days?: number | null;
    reviewer_id?: string | null;
    timeout_days?: number | null;
  }>;
  items?: Array<ReturnType<typeof makeTransitionItem>>;
}) {
  const { govConfigs = [], items = [] } = options;
  const updateCalls: Array<{
    table: string;
    data: Record<string, unknown>;
    id?: string;
  }> = [];
  const insertCalls: Array<{ table: string; data: Record<string, unknown> }> =
    [];

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'governance_config') {
      return {
        select: vi.fn().mockReturnValue({
          then: vi.fn((resolve: (v: unknown) => void) =>
            resolve({ data: govConfigs, error: null }),
          ),
        }),
      };
    }

    // ID-131 {131.19}: content_items is dying — record_lifecycle facet
    // joined to source_documents (owner_kind='source_document'). This same
    // table is queried TWICE per run: the main transitions query (terminal
    // `.neq('freshness','fresh')`, returns `items`) and the expiry-reminders
    // query (terminal `.lte(...).is(...)`, defaults to empty — unused by
    // these tests).
    if (table === 'record_lifecycle') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            then: vi.fn((resolve: (v: unknown) => void) =>
              resolve({ data: items, error: null }),
            ),
          }),
          lte: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) =>
                resolve({ data: [], error: null }),
              ),
            }),
          }),
        }),
        update: vi.fn().mockImplementation((data: Record<string, unknown>) => {
          return {
            eq: vi.fn().mockImplementation((_col1: string, _val1: string) => ({
              eq: vi.fn().mockImplementation((_col2: string, id: string) => {
                updateCalls.push({ table, data, id });
                return {
                  then: vi.fn((resolve: (v: unknown) => void) =>
                    resolve({ data: null, error: null }),
                  ),
                };
              }),
            })),
          };
        }),
      };
    }

    if (table === 'pipeline_runs') {
      return {
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
      return {
        delete: vi.fn().mockReturnValue({
          lt: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) =>
                resolve({ data: null, error: null }),
              ),
            }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                then: vi.fn((resolve: (v: unknown) => void) =>
                  resolve({ data: [], error: null }),
                ),
              }),
            }),
          }),
        }),
      };
    }

    // Default fallback
    return mockSupabase._chain;
  });

  return { updateCalls, insertCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/freshness-transitions', () => {
  beforeEach(resetMocks);

  it('returns 401 when cron auth fails', async () => {
    mockVerifyCronAuth.mockReturnValue(false);

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns empty result when no transitions detected', async () => {
    configureDetailedMock({ items: [] });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.transitions).toBeDefined();
  });
});

// ===========================================================================
// Governance bridge tests
// ===========================================================================

describe('GET /api/cron/freshness-transitions — governance bridge', () => {
  beforeEach(resetMocks);

  it('auto-flags items for governance review on stale transition (enabled)', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Stale Auto-Flag Item',
      previous_freshness: 'aging',
      freshness: 'stale',
      primary_domain: 'Operations',
      governance_review_status: null,
    });

    const { updateCalls } = configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
          reviewer_id: REVIEWER_ID,
          timeout_days: 14,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(1);

    // Check that governance status was set to pending
    const govUpdates = updateCalls.filter(
      (u) => u.data.governance_review_status === 'pending',
    );
    expect(govUpdates.length).toBe(1);
    expect(govUpdates[0].data.governance_reviewer_id).toBe(REVIEWER_ID);
    expect(govUpdates[0].data.governance_review_due).toBeDefined();

    // Check governance_review_needed notification was created
    const govNotifCalls = mockCreateBulkNotifications.mock.calls.filter(
      (call: unknown[]) => {
        const notifications = call[1] as Array<{ type: string }>;
        return notifications.some((n) => n.type === 'governance_review_needed');
      },
    );
    expect(govNotifCalls.length).toBeGreaterThan(0);

    const govNotifications = govNotifCalls[0][1] as Array<{
      userId: string;
      type: string;
      entityId: string;
    }>;

    // Should notify the reviewer
    expect(govNotifications.length).toBe(1);
    expect(govNotifications[0].type).toBe('governance_review_needed');
    expect(govNotifications[0].userId).toBe(REVIEWER_ID);
    expect(govNotifications[0].entityId).toBe(item.id);
  });

  it('auto-flags items for governance review on expired transition (enabled)', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Expired Auto-Flag Item',
      previous_freshness: 'stale',
      freshness: 'expired',
      primary_domain: 'Operations',
      governance_review_status: null,
    });

    const { updateCalls } = configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
          reviewer_id: REVIEWER_ID,
          timeout_days: 10,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(1);

    // Check governance update was made
    const govUpdates = updateCalls.filter(
      (u) => u.data.governance_review_status === 'pending',
    );
    expect(govUpdates.length).toBe(1);
    expect(govUpdates[0].id).toBe(item.id);
  });

  it('does NOT auto-flag when disabled for domain', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'stale',
      governance_review_status: null,
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: false,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
  });

  it('does NOT auto-flag on aging transition (only stale/expired)', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      previous_freshness: 'fresh',
      freshness: 'aging',
      primary_domain: 'Operations',
      governance_review_status: null,
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
  });

  it('excludes items with governance_review_status = pending from auto-flagging', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'stale',
      primary_domain: 'Operations',
      governance_review_status: 'pending',
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
  });

  it('excludes items with governance_review_status = changes_requested', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'stale',
      primary_domain: 'Operations',
      governance_review_status: 'changes_requested',
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
  });

  it('excludes items with governance_review_status = draft from auto-flagging', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'expired',
      primary_domain: 'Operations',
      governance_review_status: 'draft',
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
  });

  it('respects cooldown period and skips recently verified items', async () => {
    // Item was verified 3 days ago, cooldown is 7 days -> should skip
    const threeDaysAgo = new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'stale',
      primary_domain: 'Operations',
      governance_review_status: null,
      verified_at: threeDaysAgo,
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
  });

  it('auto-flags items when cooldown has expired (verified_at outside cooldown)', async () => {
    // Item was verified 10 days ago, cooldown is 7 days -> should flag
    const tenDaysAgo = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Expired Cooldown Item',
      freshness: 'stale',
      primary_domain: 'Operations',
      governance_review_status: null,
      verified_at: tenDaysAgo,
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(1);
  });

  it('allows auto-flag for items with governance_review_status = approved', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'stale',
      primary_domain: 'Operations',
      governance_review_status: 'approved',
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(1);
  });

  it('sends governance notification to admins when no reviewer configured', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'No Reviewer Item',
      freshness: 'stale',
      primary_domain: 'Operations',
      governance_review_status: null,
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
          reviewer_id: null,
          timeout_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(1);

    // Find governance notification call
    const govNotifCalls = mockCreateBulkNotifications.mock.calls.filter(
      (call: unknown[]) => {
        const notifications = call[1] as Array<{ type: string }>;
        return notifications.some((n) => n.type === 'governance_review_needed');
      },
    );
    expect(govNotifCalls.length).toBeGreaterThan(0);

    const govNotifications = govNotifCalls[0][1] as Array<{
      userId: string;
      type: string;
    }>;

    // Should notify both admins (no reviewer configured)
    expect(govNotifications.length).toBe(2);
    const userIds = govNotifications.map((n) => n.userId).sort();
    expect(userIds).toEqual([ADMIN_ID_1, ADMIN_ID_2].sort());
    for (const notif of govNotifications) {
      expect(notif.type).toBe('governance_review_needed');
    }
  });

  it('defaults to auto_flag_on_freshness_transition=true when no governance_config exists', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'stale',
      primary_domain: 'Unknown Domain',
      governance_review_status: null,
    });

    configureDetailedMock({
      govConfigs: [], // No config for this domain
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    // Should default to enabled when no config exists
    expect(body.auto_governance_triggered).toBe(1);
  });

  it('creates batch summary notification when >20 items are governance-flagged', async () => {
    // Generate 25 items transitioning to stale
    const items = Array.from({ length: 25 }, (_, i) =>
      makeTransitionItem({
        id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`,
        title: `Batch Item ${i + 1}`,
        previous_freshness: 'aging',
        freshness: 'stale',
        primary_domain: 'Operations',
        governance_review_status: null,
      }),
    );

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
          reviewer_id: REVIEWER_ID,
          timeout_days: 14,
        },
      ],
      items,
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(25);
    expect(body.batch_summary_notification).toBe(true);

    // Governance notifications should use batch summary path
    const govNotifCalls = mockCreateBulkNotifications.mock.calls.filter(
      (call: unknown[]) => {
        const notifications = call[1] as Array<{ type: string }>;
        return notifications.some((n) => n.type === 'governance_review_needed');
      },
    );
    expect(govNotifCalls.length).toBeGreaterThan(0);

    const govNotifications = govNotifCalls[0][1] as Array<{
      userId: string;
      type: string;
      entityType: string;
      entityId: string;
      title: string;
      message: string;
    }>;

    // Should have one notification per unique recipient (reviewer + 2 admins = 3)
    const recipientIds = new Set(govNotifications.map((n) => n.userId));
    expect(recipientIds.has(REVIEWER_ID)).toBe(true);
    expect(recipientIds.has(ADMIN_ID_1)).toBe(true);
    expect(recipientIds.has(ADMIN_ID_2)).toBe(true);

    // Summary notification uses 'domain' entity type, not 'content_item'
    for (const notif of govNotifications) {
      expect(notif.entityType).toBe('domain');
      expect(notif.title).toContain('25 items flagged');
      expect(notif.message).toContain('stale or expired');
    }
  });

  it('does NOT use batch summary for 20 or fewer governance-flagged items', async () => {
    // Generate exactly 20 items (at the threshold, not above)
    const items = Array.from({ length: 20 }, (_, i) =>
      makeTransitionItem({
        id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`,
        title: `Item ${i + 1}`,
        previous_freshness: 'aging',
        freshness: 'stale',
        primary_domain: 'Operations',
        governance_review_status: null,
      }),
    );

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
          reviewer_id: REVIEWER_ID,
          timeout_days: 14,
        },
      ],
      items,
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(20);
    expect(body.batch_summary_notification).toBe(false);

    // Individual notifications should use 'content_item' entity type
    const govNotifCalls = mockCreateBulkNotifications.mock.calls.filter(
      (call: unknown[]) => {
        const notifications = call[1] as Array<{ type: string }>;
        return notifications.some((n) => n.type === 'governance_review_needed');
      },
    );
    expect(govNotifCalls.length).toBeGreaterThan(0);

    const govNotifications = govNotifCalls[0][1] as Array<{
      entityType: string;
    }>;
    for (const notif of govNotifications) {
      expect(notif.entityType).toBe('content_item');
    }
  });

  it('logs auto_governance_triggered count in pipeline_runs', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'stale',
      primary_domain: 'Operations',
      governance_review_status: null,
    });

    const { insertCalls } = configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const pipelineInserts = insertCalls.filter(
      (c) => c.table === 'pipeline_runs',
    );
    expect(pipelineInserts.length).toBe(1);
    const result = pipelineInserts[0].data.result as Record<string, unknown>;
    expect(result.auto_governance_triggered).toBe(1);
    expect(result.batch_summary_notification).toBe(false);
  });

  it('logs auto_governance_triggered=0 when no items qualify', async () => {
    // All items are aging (not stale/expired) so no governance flagging
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      previous_freshness: 'fresh',
      freshness: 'aging',
      primary_domain: 'Operations',
      governance_review_status: null,
    });

    const { insertCalls } = configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const pipelineInserts = insertCalls.filter(
      (c) => c.table === 'pipeline_runs',
    );
    expect(pipelineInserts.length).toBe(1);
    const result = pipelineInserts[0].data.result as Record<string, unknown>;
    expect(result.auto_governance_triggered).toBe(0);
    expect(result.batch_summary_notification).toBe(false);
  });

  it('handles mixed transitions: flags stale/expired but not aging', async () => {
    const agingItem = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000011',
      title: 'Aging Item',
      previous_freshness: 'fresh',
      freshness: 'aging',
      primary_domain: 'Operations',
      governance_review_status: null,
    });

    const staleItem = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000012',
      title: 'Stale Item',
      previous_freshness: 'aging',
      freshness: 'stale',
      primary_domain: 'Operations',
      governance_review_status: null,
    });

    const expiredItem = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000013',
      title: 'Expired Item',
      previous_freshness: 'stale',
      freshness: 'expired',
      primary_domain: 'Operations',
      governance_review_status: null,
    });

    const { updateCalls } = configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [agingItem, staleItem, expiredItem],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    // Only stale and expired items should be governance-flagged
    expect(body.auto_governance_triggered).toBe(2);

    // Check that only stale/expired items got governance updates
    const govUpdates = updateCalls.filter(
      (u) => u.data.governance_review_status === 'pending',
    );
    expect(govUpdates.length).toBe(2);
    const updatedIds = govUpdates.map((u) => u.id);
    expect(updatedIds).toContain(staleItem.id);
    expect(updatedIds).toContain(expiredItem.id);
    expect(updatedIds).not.toContain(agingItem.id);
  });

  it('honours each domains configured cooldown when deciding whether to auto-flag', async () => {
    // Item was verified 5 days ago, domain cooldown is 3 days -> should flag
    const fiveDaysAgo = new Date(
      Date.now() - 5 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'stale',
      primary_domain: 'Operations',
      governance_review_status: null,
      verified_at: fiveDaysAgo,
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 3, // Shorter cooldown
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(1);
  });

  it('schedules the governance review due date using each domains configured timeout_days', async () => {
    const item = makeTransitionItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'stale',
      primary_domain: 'Operations',
      governance_review_status: null,
    });

    const { updateCalls } = configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          auto_flag_on_freshness_transition: true,
          auto_flag_cooldown_days: 7,
          reviewer_id: REVIEWER_ID,
          timeout_days: 21,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    expect(res.status).toBe(200);

    const govUpdates = updateCalls.filter(
      (u) => u.data.governance_review_status === 'pending',
    );
    expect(govUpdates.length).toBe(1);

    // Verify the review_due is approximately 21 days from now
    const reviewDue = new Date(
      govUpdates[0].data.governance_review_due as string,
    );
    const expectedDue = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
    // Allow 5 seconds of tolerance for test execution time
    expect(Math.abs(reviewDue.getTime() - expectedDue.getTime())).toBeLessThan(
      5000,
    );
  });
});
