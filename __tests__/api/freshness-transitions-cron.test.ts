/**
 * Tests for the freshness transitions cron route.
 *
 * Verifies owner-targeted vs broadcast notification behaviour:
 *   - Owned items get `owner_content_stale` to owner + `freshness_transition` to admins
 *   - Unowned items get `freshness_transition` to all admins + editors (existing behaviour)
 *   - Mixed batches handle both groups correctly
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../helpers/mock-supabase';
import { createMockCronRequest } from '../helpers/factories/cron-request';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}));

const {
  mockGetUsersByRole,
  mockCreateBulkNotifications,
  mockGetExistingNotificationIds,
} = vi.hoisted(() => ({
  mockGetUsersByRole: vi.fn(),
  mockCreateBulkNotifications: vi.fn(),
  mockGetExistingNotificationIds: vi.fn(),
}));

vi.mock('@/lib/cron-auth', () => ({
  verifyCronAuth: vi.fn(() => true),
  getUsersByRole: mockGetUsersByRole,
}));

vi.mock('@/lib/notifications', () => ({
  createBulkNotifications: mockCreateBulkNotifications,
  getExistingNotificationIds: mockGetExistingNotificationIds,
}));

vi.mock('@/lib/error', () => ({
  safeErrorMessage: vi.fn((err: unknown, fallback: string) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && err && 'message' in err)
      return (err as { message: string }).message;
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

const OWNER_ID = '00000000-0000-4000-8000-000000000099';
const ADMIN_ID_1 = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID_2 = '00000000-0000-4000-8000-000000000002';
const EDITOR_ID_1 = '00000000-0000-4000-8000-000000000003';
const ALL_USER_IDS = [ADMIN_ID_1, ADMIN_ID_2, EDITOR_ID_1];

/**
 * Builds a record_lifecycle-facet-joined-to-source_documents row, matching
 * the shape `app/api/cron/freshness-transitions/route.ts` now reads (ID-131
 * {131.19} G-GOV-FACET: content_items is dying). Keeps top-level `id`/
 * `title` convenience aliases for existing assertions.
 */
function makeTransition(
  overrides: Partial<{
    id: string;
    title: string;
    previous_freshness: string;
    freshness: string;
    primary_domain: string | null;
    updated_at: string | null;
    lifecycle_type: string | null;
    content_owner_id: string | null;
    governance_review_status: string | null;
  }> = {},
) {
  const id = overrides.id ?? '00000000-0000-4000-8000-000000000010';
  const title = overrides.title ?? 'Test Item';
  return {
    id,
    title,
    source_document_id: id,
    previous_freshness: overrides.previous_freshness ?? 'fresh',
    freshness: overrides.freshness ?? 'stale',
    lifecycle_type: overrides.lifecycle_type ?? 'standard',
    content_owner_id: overrides.content_owner_id ?? null,
    // Default to 'pending' (already in governance review, not eligible for
    // auto-flagging) — this test file is about ownership-based notification
    // ROUTING (owner_content_stale vs freshness_transition), not the
    // governance bridge (covered separately in
    // __tests__/api/cron/freshness-transitions.test.ts). A `null` default
    // would make 'stale'/'expired' items auto-governance-eligible too
    // (correct production behaviour — see D7/BI-22), introducing an
    // uncontrolled extra governance_review_needed notification here.
    governance_review_status: overrides.governance_review_status ?? 'pending',
    verified_at: null,
    source_documents: {
      id,
      filename: 'test-item.pdf',
      suggested_title: title,
      primary_domain: overrides.primary_domain ?? 'Operations',
      updated_at: overrides.updated_at ?? '2026-01-01T00:00:00Z',
    },
  };
}

function resetMocks() {
  vi.clearAllMocks();

  // Default: getUsersByRole returns all users for ['admin', 'editor']
  // and just admins for ['admin']
  mockGetUsersByRole.mockImplementation(
    (_supabase: unknown, roles: string[]) => {
      if (roles.length === 1 && roles[0] === 'admin') {
        return Promise.resolve([ADMIN_ID_1, ADMIN_ID_2]);
      }
      return Promise.resolve(ALL_USER_IDS);
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/freshness-transitions', () => {
  beforeEach(resetMocks);

  it('sends owner_content_stale to owner and freshness_transition to admins for owned items', async () => {
    const ownedItem = makeTransition({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Owned Item',
      content_owner_id: OWNER_ID,
      previous_freshness: 'fresh',
      freshness: 'stale',
    });

    // governance_config query (runs first in the route) — return empty config
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    // content_items query returns the owned item
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [ownedItem], error: null }),
    );

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notifications_created).toBeGreaterThan(0);

    // Verify createBulkNotifications was called
    expect(mockCreateBulkNotifications).toHaveBeenCalled();

    // The owned items batch should have owner_content_stale for the owner
    // and freshness_transition for admins
    const allNotifications = mockCreateBulkNotifications.mock.calls.flatMap(
      (call: unknown[]) => call[1] as Array<{ userId: string; type: string }>,
    );

    const ownerNotifs = allNotifications.filter(
      (n: { userId: string; type: string }) =>
        n.userId === OWNER_ID && n.type === 'owner_content_stale',
    );
    expect(ownerNotifs.length).toBe(1);

    const adminNotifs = allNotifications.filter(
      (n: { userId: string; type: string }) =>
        n.type === 'freshness_transition',
    );
    // Admins should get freshness_transition
    expect(adminNotifs.length).toBe(2); // 2 admins
    for (const notif of adminNotifs) {
      expect([ADMIN_ID_1, ADMIN_ID_2]).toContain(notif.userId);
    }
  });

  it('sends freshness_transition to all admins+editors for unowned items', async () => {
    const unownedItem = makeTransition({
      id: '00000000-0000-4000-8000-000000000020',
      title: 'Unowned Item',
      content_owner_id: null,
      previous_freshness: 'aging',
      freshness: 'stale',
    });

    // governance_config query (runs first in the route) — return empty config
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [unownedItem], error: null }),
    );

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notifications_created).toBeGreaterThan(0);

    const allNotifications = mockCreateBulkNotifications.mock.calls.flatMap(
      (call: unknown[]) => call[1] as Array<{ userId: string; type: string }>,
    );

    // All should be freshness_transition (no owner_content_stale)
    expect(
      allNotifications.every(
        (n: { type: string }) => n.type === 'freshness_transition',
      ),
    ).toBe(true);
    // Should go to all 3 users (2 admins + 1 editor)
    expect(allNotifications.length).toBe(3);
  });

  it('handles mixed batch — owned and unowned items together', async () => {
    const ownedItem = makeTransition({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Owned Item',
      content_owner_id: OWNER_ID,
      previous_freshness: 'fresh',
      freshness: 'stale',
    });
    const unownedItem = makeTransition({
      id: '00000000-0000-4000-8000-000000000020',
      title: 'Unowned Item',
      content_owner_id: null,
      previous_freshness: 'aging',
      freshness: 'expired',
    });

    // governance_config query (runs first in the route) — return empty config
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [ownedItem, unownedItem], error: null }),
    );

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notifications_created).toBeGreaterThan(0);

    const allNotifications = mockCreateBulkNotifications.mock.calls.flatMap(
      (call: unknown[]) =>
        call[1] as Array<{ userId: string; type: string; entityId: string }>,
    );

    // Owned item: owner gets owner_content_stale, admins get freshness_transition
    const ownerStaleNotifs = allNotifications.filter(
      (n: { type: string; entityId: string }) =>
        n.type === 'owner_content_stale' && n.entityId === ownedItem.id,
    );
    expect(ownerStaleNotifs.length).toBe(1);
    expect(ownerStaleNotifs[0].userId).toBe(OWNER_ID);

    // Unowned item: all admins+editors get freshness_transition
    const unownedNotifs = allNotifications.filter(
      (n: { type: string; entityId: string }) =>
        n.type === 'freshness_transition' && n.entityId === unownedItem.id,
    );
    expect(unownedNotifs.length).toBe(3); // 2 admins + 1 editor
  });

  it('returns 0 notifications when no transitions detected', async () => {
    // governance_config query (runs first in the route) — return empty config
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    // Return items where freshness === previous_freshness (no change)
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: '00000000-0000-4000-8000-000000000010',
              title: 'Stable',
              previous_freshness: 'stale',
              freshness: 'stale',
              primary_domain: null,
              updated_at: null,
              lifecycle_type: null,
              content_owner_id: null,
            },
          ],
          error: null,
        }),
    );

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notifications_created).toBe(0);
  });

  it('skips items that already have notifications today (idempotency)', async () => {
    const item = makeTransition({
      id: '00000000-0000-4000-8000-000000000010',
      content_owner_id: null,
    });

    // governance_config query (runs first in the route) — return empty config
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [item], error: null }),
    );

    // Both idempotency checks return the item as already notified
    mockGetExistingNotificationIds.mockResolvedValue(new Set([item.id]));

    const res = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
      }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notifications_created).toBe(0);
    expect(mockCreateBulkNotifications).not.toHaveBeenCalled();
  });
});
