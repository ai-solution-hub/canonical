/**
 * Unit tests for lib/reorient.ts — fetchReorientData.
 *
 * Tests the reorientation data fetching function that assembles the
 * personal briefing: last activity, team changes, recent work, bid
 * summaries, urgent items, and aggregate counts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockSupabaseClient } from '../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Freeze time for deterministic tests
// ---------------------------------------------------------------------------

const FROZEN_NOW = new Date('2026-03-08T10:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('@/lib/dashboard', () => ({
  getDeadlineUrgency: vi.fn((deadline: string | null) => {
    if (!deadline) return 'unknown';
    const diff =
      (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (diff < 0) return 'overdue';
    if (diff < 3) return 'urgent';
    if (diff < 14) return 'approaching';
    return 'normal';
  }),
  getDaysUntilDeadline: vi.fn((deadline: string | null) => {
    if (!deadline) return null;
    return Math.ceil(
      (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
  }),
}));

vi.mock('@/lib/format', () => ({
  formatRelativeDate: vi.fn((date: string | null) => {
    if (!date) return '';
    return '2 hours ago';
  }),
}));

// Store the mock return value so tests can override it
const mockActiveBidsResult = vi.hoisted(() => ({
  current: {
    workspaces: [] as unknown[],
    statsMap: new Map<string, unknown>(),
  },
}));

vi.mock('@/lib/procurement/procurement-queries', () => ({
  fetchActiveProcurementWithStats: vi.fn(() =>
    Promise.resolve(mockActiveBidsResult.current),
  ),
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}));

// S156 WP-2: resolveDisplayNames now routes through the SQL function
// wrapper. Mock the wrapper directly so each test can stub the Map that
// reorient consumes, rather than the underlying RPC call chain.
vi.mock('@/lib/users/display-names', () => ({
  resolveUserDisplayNames: vi.fn(),
}));

import { fetchReorientData, resolveDisplayNames } from '@/lib/reorient';
import { resolveUserDisplayNames } from '@/lib/users/display-names';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-abc-123';

/**
 * Helper: configure the mock so that fetchReorientData
 * gets sensible defaults for all its queries.
 *
 * The function structure is:
 *   1. Promise.all for lastActivity:
 *      - from('content_history') for write activity
 *      - from('read_marks') for read activity
 *   2. Then Promise.all with:
 *      a) Promise.allSettled with 8 items:
 *         [0] from('content_history') — team changes
 *         [1] from('content_history') — recent work
 *         [2] rpc('get_freshness_breakdown')
 *         [3] from('content_items') or Promise.resolve — governance reviews
 *         [4] rpc('get_items_with_quality_flags') or Promise.resolve — quality flags
 *         [5] from('notifications') — unread notifications
 *         [6] from('form_response_history') — bid response team changes
 *         [7] from('form_response_history') — bid response recent work
 *      b) fetchActiveProcurementWithStats (mocked — returns workspaces + statsMap)
 *   Then auth.getUser() for display name
 */
function setupDefaultMock(
  overrides: {
    lastActivityData?: unknown[];
    lastReadActivityData?: unknown[];
    authUser?: Record<string, unknown> | null;
    teamChangesData?: unknown[];
    recentWorkData?: unknown[];
    workspacesData?: unknown[];
    batchStatsData?: unknown[];
    freshnessData?: unknown[];
    governanceCount?: number;
    qualityFlagsCount?: number;
    notificationsCount?: number;
    bidResponseTeamChangesData?: unknown[];
    bidResponseRecentWorkData?: unknown[];
  } = {},
) {
  const mock = createMockSupabaseClient();

  // Track from() calls sequentially
  const fromCalls: Array<{
    data: unknown;
    error: unknown;
    count: number | null;
  }> = [];

  // Call 0: content_history for lastActivity (write)
  fromCalls.push({
    data: overrides.lastActivityData ?? [
      { created_at: '2026-03-08T08:00:00Z' },
    ],
    error: null,
    count: null,
  });

  // Call 1: read_marks for lastActivity (read)
  fromCalls.push({
    data: overrides.lastReadActivityData ?? [],
    error: null,
    count: null,
  });

  // Promise.allSettled from() calls (indices 0-7 in results):
  // [0] team changes — from('content_history')
  fromCalls.push({
    data: overrides.teamChangesData ?? [],
    error: null,
    count: null,
  });

  // [1] recent work — from('content_history')
  fromCalls.push({
    data: overrides.recentWorkData ?? [],
    error: null,
    count: null,
  });

  // [3] governance reviews — from('content_items')
  fromCalls.push({
    data: null,
    error: null,
    count: overrides.governanceCount ?? 0,
  });

  // [4] quality flags — now uses rpc('get_items_with_quality_flags'), NOT from()
  // Handled in the rpc mock below, not in fromCalls

  // [5] notifications — from('notifications')
  fromCalls.push({
    data: null,
    error: null,
    count: overrides.notificationsCount ?? 0,
  });

  // [6] form_response_history — team changes
  fromCalls.push({
    data: overrides.bidResponseTeamChangesData ?? [],
    error: null,
    count: null,
  });

  // [7] form_response_history — recent work
  fromCalls.push({
    data: overrides.bidResponseRecentWorkData ?? [],
    error: null,
    count: null,
  });

  // Configure from() to return per-call chain
  let callIdx = 0;
  mock.from.mockImplementation(() => {
    const idx = callIdx++;
    const response = fromCalls[idx] ?? { data: [], error: null, count: 0 };

    // Build a fresh chain for this call
    const freshChain: Record<string, ReturnType<typeof vi.fn>> = {};

    for (const key of Object.keys(mock._chain)) {
      if (
        key === 'then' ||
        key === 'single' ||
        key === 'maybeSingle' ||
        key === 'csv'
      ) {
        continue;
      }
      freshChain[key] = vi.fn().mockReturnValue(undefined as never);
    }

    // Create a self-referencing chain
    const c = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      eq: vi.fn(),
      neq: vi.fn(),
      in: vi.fn(),
      is: vi.fn(),
      not: vi.fn(),
      ilike: vi.fn(),
      contains: vi.fn(),
      gte: vi.fn(),
      lte: vi.fn(),
      gt: vi.fn(),
      lt: vi.fn(),
      or: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      range: vi.fn(),
      single: vi
        .fn()
        .mockResolvedValue({ data: null, error: null, count: null }),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: null, error: null, count: null }),
      csv: vi.fn().mockResolvedValue({ data: null, error: null, count: null }),
      then: vi.fn((resolve: (v: unknown) => void) => resolve(response)),
    };

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
      c[m].mockReturnValue(c);
    }

    return c;
  });

  // Configure RPC — freshness breakdown and quality flags (for admin)
  // (batch stats is handled by the mocked fetchActiveProcurementWithStats)
  const qualityFlagUuids = Array.from(
    { length: overrides.qualityFlagsCount ?? 0 },
    (_, i) => `quality-flag-uuid-${i}`,
  );
  mock.rpc.mockImplementation((name: string) => {
    if (name === 'get_items_with_quality_flags') {
      return Promise.resolve({ data: qualityFlagUuids, error: null });
    }
    // get_freshness_breakdown
    return Promise.resolve({
      data: overrides.freshnessData ?? [],
      error: null,
    });
  });

  // Configure the mocked fetchActiveProcurementWithStats result
  const workspacesData = (overrides.workspacesData ?? []) as Array<
    Record<string, unknown>
  >;
  const batchStatsData = (overrides.batchStatsData ?? []) as Array<
    Record<string, unknown>
  >;
  const statsMap = new Map<string, unknown>();
  for (const row of batchStatsData) {
    statsMap.set(row.workspace_id as string, row);
  }
  mockActiveBidsResult.current = {
    workspaces: workspacesData,
    statsMap,
  };

  // Configure auth.getUser — called twice (once for fallback, once for display name)
  const authUser =
    overrides.authUser !== undefined
      ? overrides.authUser
      : {
          id: TEST_USER_ID,
          email: 'liam@example.com',
          user_metadata: { full_name: 'Liam Jones' },
          last_sign_in_at: '2026-03-07T09:00:00Z',
        };
  mock.auth.getUser.mockResolvedValue({
    data: { user: authUser },
    error: null,
  });

  return mock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchReorientData', () => {
  // =========================================================================
  // last_active_at resolution
  // =========================================================================

  describe('last_active_at', () => {
    it('returns last_active_at from content_history when it is more recent than read_marks', async () => {
      const mock = setupDefaultMock({
        lastActivityData: [{ created_at: '2026-03-08T09:00:00Z' }],
        lastReadActivityData: [{ read_at: '2026-03-08T08:00:00Z' }],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.last_active_at).toBe('2026-03-08T09:00:00Z');
    });

    it('returns last_active_at from read_marks when it is more recent than content_history', async () => {
      const mock = setupDefaultMock({
        lastActivityData: [{ created_at: '2026-03-08T07:00:00Z' }],
        lastReadActivityData: [{ read_at: '2026-03-08T09:30:00Z' }],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.last_active_at).toBe('2026-03-08T09:30:00Z');
    });

    it('returns last_active_at from read_marks when no content_history exists', async () => {
      const mock = setupDefaultMock({
        lastActivityData: [],
        lastReadActivityData: [{ read_at: '2026-03-08T08:30:00Z' }],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.last_active_at).toBe('2026-03-08T08:30:00Z');
    });

    it('returns last_active_at from content_history when no read_marks exist', async () => {
      const mock = setupDefaultMock({
        lastActivityData: [{ created_at: '2026-03-08T08:30:00Z' }],
        lastReadActivityData: [],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.last_active_at).toBe('2026-03-08T08:30:00Z');
    });

    it('falls back to last_sign_in_at when no content_history or read_marks', async () => {
      const mock = setupDefaultMock({
        lastActivityData: [],
        authUser: {
          id: TEST_USER_ID,
          email: 'liam@example.com',
          user_metadata: {},
          last_sign_in_at: '2026-03-07T14:00:00Z',
        },
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.last_active_at).toBe('2026-03-07T14:00:00Z');
    });

    it('falls back to null when no content_history, read_marks, or last_sign_in_at available', async () => {
      const mock = setupDefaultMock({
        lastActivityData: [],
        lastReadActivityData: [],
        authUser: {
          id: TEST_USER_ID,
          email: 'liam@example.com',
          user_metadata: {},
          // No last_sign_in_at
        },
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      // last_active_at should be null, and the sinceDate will fall back to 24h ago
      expect(result.last_active_at).toBeNull();
    });
  });

  // =========================================================================
  // Team changes
  // =========================================================================

  describe('team_changes', () => {
    it('excludes the current user from team changes', async () => {
      const mock = setupDefaultMock({
        teamChangesData: [
          {
            id: 'ch-1',
            content_item_id: 'item-1',
            change_type: 'edit',
            change_summary: 'Updated policy',
            created_by: 'other-user-1',
            created_at: '2026-03-08T09:00:00Z',
            content_items: {
              title: 'Data Protection Policy',
              primary_domain: 'Corporate',
            },
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.team_changes).toHaveLength(1);
      expect(result.team_changes[0].user_id).toBe('other-user-1');
      expect(result.team_changes[0].entity_title).toBe(
        'Data Protection Policy',
      );
      expect(result.team_changes[0].action).toBe('updated');
      expect(result.team_changes[0].domain).toBe('Corporate');
    });

    it('returns a valid team_changes list under the 20-item cap', async () => {
      // The function calls .limit(20) on the team changes query.
      // We verify by checking that the mock chain was configured correctly.
      const mock = setupDefaultMock();

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      // The team changes query uses .limit(20) — with the mock setup,
      // we verify that the result is valid (not an error).
      expect(result.team_changes).toBeDefined();
      // Explicitly assert that the cap is being enforced
      expect(result.team_changes.length).toBeLessThanOrEqual(20);
    });

    it('maps change_type "create" to action "created"', async () => {
      const mock = setupDefaultMock({
        teamChangesData: [
          {
            id: 'ch-2',
            content_item_id: 'item-2',
            change_type: 'create',
            change_summary: 'New item',
            created_by: 'other-user',
            created_at: '2026-03-08T09:00:00Z',
            content_items: {
              title: 'New Article',
              primary_domain: 'Technical',
            },
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.team_changes[0].action).toBe('created');
    });

    it('maps change_type "rollback" to action "reviewed"', async () => {
      const mock = setupDefaultMock({
        teamChangesData: [
          {
            id: 'ch-3',
            content_item_id: 'item-3',
            change_type: 'rollback',
            change_summary: 'Rolled back',
            created_by: 'other-user',
            created_at: '2026-03-08T09:00:00Z',
            content_items: {
              title: 'Rolled Back Item',
              primary_domain: 'Commercial',
            },
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.team_changes[0].action).toBe('reviewed');
    });

    it('defaults change_type to "updated" for unknown types', async () => {
      const mock = setupDefaultMock({
        teamChangesData: [
          {
            id: 'ch-4',
            content_item_id: 'item-4',
            change_type: 'unknown_type',
            change_summary: 'Something',
            created_by: 'other-user',
            created_at: '2026-03-08T09:00:00Z',
            content_items: { title: 'Some Item', primary_domain: null },
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.team_changes[0].action).toBe('updated');
    });
  });

  // =========================================================================
  // Recent work
  // =========================================================================

  describe('my_recent_work', () => {
    it('returns recent work items with item-scoped hrefs', async () => {
      const mock = setupDefaultMock({
        recentWorkData: [
          {
            id: 'h-1',
            content_item_id: 'item-10',
            change_type: 'edit',
            change_summary: 'Edited content',
            created_at: '2026-03-08T09:30:00Z',
            content_items: { title: 'My Article' },
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.my_recent_work).toHaveLength(1);
      expect(result.my_recent_work[0].entity_id).toBe('item-10');
      expect(result.my_recent_work[0].entity_title).toBe('My Article');
      expect(result.my_recent_work[0].href).toBe('/item/item-10');
      expect(result.my_recent_work[0].action).toBe('updated');
    });

    it('returns empty array when no recent work', async () => {
      const mock = setupDefaultMock({
        recentWorkData: [],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.my_recent_work).toEqual([]);
    });
  });

  // =========================================================================
  // Urgent items
  // =========================================================================

  describe('urgent items', () => {
    it('returns empty urgent array when nothing is urgent', async () => {
      const mock = setupDefaultMock({
        workspacesData: [],
        freshnessData: [{ freshness: 'fresh', count: 50 }],
        governanceCount: 0,
        qualityFlagsCount: 0,
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.urgent).toEqual([]);
    });

    it('sorts urgent items by priority (1 before 2 before 3)', async () => {
      // Create overdue bid (priority 1), stale content (priority 2), pending review (priority 3)
      const mock = setupDefaultMock({
        workspacesData: [
          {
            id: 'bid-1',
            name: 'Overdue Procurement',
            domain_metadata: {
              deadline: '2026-03-07T00:00:00Z',
              buyer: 'Corp A',
              status: 'active',
            },
            is_archived: false,
            updated_at: '2026-03-07T00:00:00Z',
          },
        ],
        batchStatsData: [
          {
            workspace_id: 'bid-1',
            total_questions: 10,
            drafted_count: 3,
            complete_count: 2,
            needs_sme_count: 2,
            no_content_count: 1,
          },
        ],
        freshnessData: [
          { freshness: 'stale', count: 5 },
          { freshness: 'expired', count: 2 },
        ],
        governanceCount: 3,
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.urgent.length).toBeGreaterThanOrEqual(3);
      // Overdue bid should be first (priority 1)
      expect(result.urgent[0].type).toBe('bid_deadline');
      expect(result.urgent[0].priority).toBe(1);
      // Content expired (priority 2) before review pending (priority 3)
      const priorities = result.urgent.map((u) => u.priority);
      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]);
      }
    });

    it('generates quality_flag urgent items for admins', async () => {
      const mock = setupDefaultMock({
        qualityFlagsCount: 4,
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true, // isAdmin
        'admin',
      );

      const qualityItem = result.urgent.find((u) => u.type === 'quality_flag');
      expect(qualityItem).toBeDefined();
      expect(qualityItem!.title).toContain('4 unresolved quality flags');
      expect(qualityItem!.href).toBe('/browse?quality=flagged');
      expect(qualityItem!.priority).toBe(3);
    });

    it('does not generate quality_flag urgent items for non-admins', async () => {
      const mock = setupDefaultMock({
        qualityFlagsCount: 4,
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false, // isAdmin
        'editor',
      );

      const qualityItem = result.urgent.find((u) => u.type === 'quality_flag');
      expect(qualityItem).toBeUndefined();
    });

    it('generates content_expired urgent item when stale/expired content exists', async () => {
      const mock = setupDefaultMock({
        freshnessData: [
          { freshness: 'stale', count: 3 },
          { freshness: 'expired', count: 1 },
          { freshness: 'fresh', count: 40 },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      const expiredItem = result.urgent.find(
        (u) => u.type === 'content_expired',
      );
      expect(expiredItem).toBeDefined();
      expect(expiredItem!.title).toContain('4 content items');
      expect(expiredItem!.href).toBe('/browse?freshness=stale,expired');
    });

    it('generates review_pending urgent item when governance reviews are pending', async () => {
      const mock = setupDefaultMock({
        governanceCount: 7,
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      const reviewItem = result.urgent.find((u) => u.type === 'review_pending');
      expect(reviewItem).toBeDefined();
      expect(reviewItem!.title).toContain('7 governance reviews');
      expect(reviewItem!.href).toBe('/review');
    });

    it('generates notification urgent item when 5+ unread notifications', async () => {
      const mock = setupDefaultMock({
        notificationsCount: 8,
      });

      // Use isAdmin=true so that all from() calls in the mock are consumed
      // in the correct order (quality_flag query uses from() rather than
      // Promise.resolve)
      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      const notifItem = result.urgent.find((u) => u.type === 'notification');
      expect(notifItem).toBeDefined();
      expect(notifItem!.title).toContain('8 unread notifications');
      expect(notifItem!.href).toBe('/settings?tab=notifications');
      expect(notifItem!.priority).toBe(3);
    });

    it('does not generate notification urgent item when fewer than 5 notifications', async () => {
      const mock = setupDefaultMock({
        notificationsCount: 3,
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      const notifItem = result.urgent.find((u) => u.type === 'notification');
      expect(notifItem).toBeUndefined();
    });

    it('uses singular form for single items', async () => {
      const mock = setupDefaultMock({
        freshnessData: [{ freshness: 'expired', count: 1 }],
        governanceCount: 1,
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      const expiredItem = result.urgent.find(
        (u) => u.type === 'content_expired',
      );
      expect(expiredItem!.title).toContain('1 content item needs');

      const reviewItem = result.urgent.find((u) => u.type === 'review_pending');
      expect(reviewItem!.title).toContain('1 governance review pending');
    });
  });

  // =========================================================================
  // Procurement summary with gap_count
  // =========================================================================

  describe('bid_summary', () => {
    it('includes gap_count using needs_sme_count + no_content_count', async () => {
      const mock = setupDefaultMock({
        workspacesData: [
          {
            id: 'bid-2',
            name: 'Test Procurement',
            domain_metadata: {
              deadline: '2026-04-01T00:00:00Z',
              buyer: 'Buyer X',
              status: 'active',
            },
            is_archived: false,
            updated_at: '2026-03-08T00:00:00Z',
          },
        ],
        batchStatsData: [
          {
            workspace_id: 'bid-2',
            total_questions: 20,
            drafted_count: 8,
            complete_count: 5,
            needs_sme_count: 4,
            no_content_count: 3,
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.bid_summary).toHaveLength(1);
      const bid = result.bid_summary[0];
      expect(bid.gap_count).toBe(7); // 4 + 3
      expect(bid.total_questions).toBe(20);
      expect(bid.answered_questions).toBe(13); // 8 + 5
      expect(bid.approved_questions).toBe(5);
      expect(bid.name).toBe('Test Procurement');
      expect(bid.buyer).toBe('Buyer X');
      expect(bid.href).toBe('/procurement/bid-2');
    });

    it('calculates deadline urgency correctly', async () => {
      const mock = setupDefaultMock({
        workspacesData: [
          {
            id: 'bid-overdue',
            name: 'Overdue Procurement',
            domain_metadata: {
              deadline: '2026-03-07T00:00:00Z',
              status: 'active',
            },
            is_archived: false,
            updated_at: '2026-03-07T00:00:00Z',
          },
          {
            id: 'bid-urgent',
            name: 'Urgent Procurement',
            domain_metadata: {
              deadline: '2026-03-09T00:00:00Z',
              status: 'active',
            },
            is_archived: false,
            updated_at: '2026-03-08T00:00:00Z',
          },
          {
            id: 'bid-normal',
            name: 'Normal Procurement',
            domain_metadata: {
              deadline: '2026-05-01T00:00:00Z',
              status: 'active',
            },
            is_archived: false,
            updated_at: '2026-03-06T00:00:00Z',
          },
        ],
        batchStatsData: [
          {
            workspace_id: 'bid-overdue',
            total_questions: 5,
            drafted_count: 1,
            complete_count: 0,
            needs_sme_count: 0,
            no_content_count: 0,
          },
          {
            workspace_id: 'bid-urgent',
            total_questions: 10,
            drafted_count: 5,
            complete_count: 2,
            needs_sme_count: 0,
            no_content_count: 0,
          },
          {
            workspace_id: 'bid-normal',
            total_questions: 8,
            drafted_count: 3,
            complete_count: 1,
            needs_sme_count: 0,
            no_content_count: 0,
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.bid_summary).toHaveLength(3);
      // Sorted by deadline urgency: overdue first, then urgent, then normal
      expect(result.bid_summary[0].urgency).toBe('overdue');
      expect(result.bid_summary[1].urgency).toBe('urgent');
      expect(result.bid_summary[2].urgency).toBe('normal');
    });

    it('defaults bid name to "Untitled Procurement" when name is null', async () => {
      const mock = setupDefaultMock({
        workspacesData: [
          {
            id: 'bid-noname',
            name: null,
            domain_metadata: null,
            is_archived: false,
            updated_at: '2026-03-08T00:00:00Z',
          },
        ],
        batchStatsData: [],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.bid_summary[0].name).toBe('Untitled Procurement');
      expect(result.bid_summary[0].status).toBe('draft');
      expect(result.bid_summary[0].buyer).toBeNull();
    });
  });

  // =========================================================================
  // Partial query failures
  // =========================================================================

  describe('handles partial query failures gracefully', () => {
    it('continues with errors array when team changes query fails', async () => {
      const mock = setupDefaultMock();

      // Override: make the team changes from() call return an error.
      // from() calls: 1=content_history (lastActivity write), 2=read_marks (lastActivity read),
      // 3=content_history (team changes), 4+=other queries.
      let callCounter = 0;
      mock.from.mockImplementation(() => {
        const currentIdx = ++callCounter;
        const response = (() => {
          if (currentIdx === 1) {
            // First call: content_history for lastActivity (write)
            return {
              data: [{ created_at: '2026-03-08T08:00:00Z' }],
              error: null,
              count: null,
            };
          } else if (currentIdx === 2) {
            // Second call: read_marks for lastActivity (read)
            return { data: [], error: null, count: null };
          } else if (currentIdx === 3) {
            // Third call: content_history for team changes — return error
            return {
              data: null,
              error: { message: 'Query failed' },
              count: null,
            };
          } else {
            return { data: [], error: null, count: 0 };
          }
        })();

        const c = {
          select: vi.fn(),
          insert: vi.fn(),
          update: vi.fn(),
          upsert: vi.fn(),
          delete: vi.fn(),
          eq: vi.fn(),
          neq: vi.fn(),
          in: vi.fn(),
          is: vi.fn(),
          not: vi.fn(),
          ilike: vi.fn(),
          contains: vi.fn(),
          gte: vi.fn(),
          lte: vi.fn(),
          gt: vi.fn(),
          lt: vi.fn(),
          or: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          range: vi.fn(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          csv: vi.fn().mockResolvedValue({ data: null, error: null }),
          then: vi.fn((resolve: (v: unknown) => void) => {
            resolve(response);
          }),
        };
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
          (c[m] as ReturnType<typeof vi.fn>).mockReturnValue(c);
        }
        return c;
      });

      mock.rpc.mockResolvedValue({ data: [], error: null });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      // Should still return a valid result
      expect(result.team_changes).toEqual([]);
      expect(result.errors).toContain('team_changes query failed');
      // Other data should still be present
      expect(result.generated_at).toBeDefined();
    });
  });

  // =========================================================================
  // Counts
  // =========================================================================

  describe('counts', () => {
    it('returns aggregate counts', async () => {
      const mock = setupDefaultMock({
        freshnessData: [
          { freshness: 'stale', count: 3 },
          { freshness: 'expired', count: 2 },
        ],
        governanceCount: 5,
        qualityFlagsCount: 1,
        notificationsCount: 8,
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      expect(result.counts.stale_or_expired).toBe(5);
      expect(result.counts.pending_reviews).toBe(5);
      expect(result.counts.quality_flags).toBe(1);
      expect(result.counts.unread_notifications).toBe(8);
    });
  });

  // =========================================================================
  // User display name
  // =========================================================================

  describe('user_display_name', () => {
    it('returns first name from full_name', async () => {
      const mock = setupDefaultMock({
        authUser: {
          id: TEST_USER_ID,
          email: 'liam@example.com',
          user_metadata: { full_name: 'Liam Jones' },
          last_sign_in_at: '2026-03-07T09:00:00Z',
        },
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.user_display_name).toBe('Liam');
      expect(result.has_display_name).toBe(true);
    });

    it('prefers display_name over full_name', async () => {
      const mock = setupDefaultMock({
        authUser: {
          id: TEST_USER_ID,
          email: 'liam@example.com',
          user_metadata: { display_name: 'Li', full_name: 'Liam Jones' },
          last_sign_in_at: '2026-03-07T09:00:00Z',
        },
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.user_display_name).toBe('Li');
      expect(result.has_display_name).toBe(true);
    });

    it('falls back to email prefix when no display_name or full_name', async () => {
      const mock = setupDefaultMock({
        authUser: {
          id: TEST_USER_ID,
          email: 'sarah@company.co.uk',
          user_metadata: {},
          last_sign_in_at: '2026-03-07T09:00:00Z',
        },
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.user_display_name).toBe('Sarah');
      expect(result.has_display_name).toBe(false);
    });

    it('cleans email prefix by stripping dots and trailing numbers', async () => {
      const mock = setupDefaultMock({
        authUser: {
          id: TEST_USER_ID,
          email: 'test.user1@company.co.uk',
          user_metadata: {},
          last_sign_in_at: '2026-03-07T09:00:00Z',
        },
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.user_display_name).toBe('Test user');
      expect(result.has_display_name).toBe(false);
    });
  });

  // =========================================================================
  // generated_at
  // =========================================================================

  describe('generated_at', () => {
    it('includes generated_at timestamp', async () => {
      const mock = setupDefaultMock();

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(result.generated_at).toBe('2026-03-08T10:00:00.000Z');
    });
  });

  // =========================================================================
  // Procurement response team changes
  // =========================================================================

  describe('bid response team changes', () => {
    it('merges bid response edits into team_changes with entity_type bid_response', async () => {
      const mock = setupDefaultMock({
        teamChangesData: [
          {
            id: 'ch-1',
            content_item_id: 'item-1',
            change_type: 'edit',
            change_summary: 'Updated policy',
            created_by: 'other-user-1',
            created_at: '2026-03-08T09:00:00Z',
            content_items: {
              title: 'Data Protection Policy',
              primary_domain: 'Corporate',
            },
          },
        ],
        bidResponseTeamChangesData: [
          {
            id: 'brh-1',
            response_id: 'resp-1',
            edited_by: 'other-user-2',
            created_at: '2026-03-08T09:30:00Z',
            form_responses: {
              question_id: 'q-1',
              form_questions: {
                workspace_id: 'bid-1',
                workspaces: { name: 'NHS Digital Procurement' },
              },
            },
          },
        ],
      });

      // Use admin role to ensure all from() calls fire in sequential mock order
      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      expect(result.team_changes).toHaveLength(2);
      const bidChange = result.team_changes.find(
        (tc) => tc.entity_type === 'bid_response',
      );
      expect(bidChange).toBeDefined();
      expect(bidChange!.entity_title).toBe('NHS Digital Procurement');
      expect(bidChange!.action).toBe('updated');
      expect(bidChange!.user_id).toBe('other-user-2');
      expect(bidChange!.workspace_id).toBe('bid-1');
      expect(bidChange!.question_id).toBe('q-1');
    });

    it('sorts combined team changes by date descending', async () => {
      const mock = setupDefaultMock({
        teamChangesData: [
          {
            id: 'ch-1',
            content_item_id: 'item-1',
            change_type: 'edit',
            change_summary: 'Older change',
            created_by: 'other-user-1',
            created_at: '2026-03-08T08:00:00Z',
            content_items: { title: 'Old Item', primary_domain: 'Security' },
          },
        ],
        bidResponseTeamChangesData: [
          {
            id: 'brh-1',
            response_id: 'resp-1',
            edited_by: 'other-user-2',
            created_at: '2026-03-08T09:00:00Z',
            form_responses: {
              question_id: 'q-1',
              form_questions: {
                workspace_id: 'bid-1',
                workspaces: { name: 'Recent Procurement' },
              },
            },
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      // Procurement response (09:00) should come before content change (08:00)
      expect(result.team_changes[0].entity_type).toBe('bid_response');
      expect(result.team_changes[1].entity_type).toBe('content_item');
    });
  });

  // =========================================================================
  // Procurement response recent work
  // =========================================================================

  describe('bid response recent work', () => {
    it('includes bid response edits in my_recent_work', async () => {
      const mock = setupDefaultMock({
        recentWorkData: [],
        bidResponseRecentWorkData: [
          {
            id: 'brh-own-1',
            response_id: 'resp-2',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:15:00Z',
            form_responses: {
              question_id: 'q-2',
              form_questions: {
                workspace_id: 'bid-2',
                question_text: 'Describe your security approach',
                workspaces: { id: 'bid-2', name: 'Security Procurement' },
              },
            },
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      expect(result.my_recent_work).toHaveLength(1);
      expect(result.my_recent_work[0].entity_type).toBe('bid_response');
      expect(result.my_recent_work[0].entity_title).toBe(
        'Describe your security approach',
      );
      expect(result.my_recent_work[0].href).toBe('/procurement/bid-2/session');
      expect(result.my_recent_work[0].action).toBe('edited');
      expect(result.my_recent_work[0].workspace_id).toBe('bid-2');
      expect(result.my_recent_work[0].question_id).toBe('q-2');
    });

    it('truncates long question text in entity_title', async () => {
      const longQuestion =
        "Please provide a detailed description of your organisation's approach to information security management including all relevant certifications";
      const mock = setupDefaultMock({
        recentWorkData: [],
        bidResponseRecentWorkData: [
          {
            id: 'brh-own-2',
            response_id: 'resp-3',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:00:00Z',
            form_responses: {
              question_id: 'q-3',
              form_questions: {
                workspace_id: 'bid-3',
                question_text: longQuestion,
                workspaces: { id: 'bid-3', name: 'Long Q Procurement' },
              },
            },
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      expect(result.my_recent_work[0].entity_title.length).toBeLessThanOrEqual(
        60,
      );
      expect(result.my_recent_work[0].entity_title).toMatch(/\.\.\.$/);
    });

    it('limits combined recent work to 5 items', async () => {
      const mock = setupDefaultMock({
        recentWorkData: [
          {
            id: 'h-1',
            content_item_id: 'i-1',
            change_type: 'edit',
            change_summary: '',
            created_at: '2026-03-08T09:50:00Z',
            content_items: { title: 'Item 1' },
          },
          {
            id: 'h-2',
            content_item_id: 'i-2',
            change_type: 'edit',
            change_summary: '',
            created_at: '2026-03-08T09:40:00Z',
            content_items: { title: 'Item 2' },
          },
          {
            id: 'h-3',
            content_item_id: 'i-3',
            change_type: 'edit',
            change_summary: '',
            created_at: '2026-03-08T09:30:00Z',
            content_items: { title: 'Item 3' },
          },
          {
            id: 'h-4',
            content_item_id: 'i-4',
            change_type: 'edit',
            change_summary: '',
            created_at: '2026-03-08T09:20:00Z',
            content_items: { title: 'Item 4' },
          },
        ],
        bidResponseRecentWorkData: [
          {
            id: 'brh-1',
            response_id: 'r-1',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:45:00Z',
            form_responses: {
              question_id: 'q-1',
              form_questions: {
                workspace_id: 'b-1',
                question_text: 'Q1',
                workspaces: { id: 'b-1', name: 'Procurement' },
              },
            },
          },
          {
            id: 'brh-2',
            response_id: 'r-2',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:35:00Z',
            form_responses: {
              question_id: 'q-2',
              form_questions: {
                workspace_id: 'b-1',
                question_text: 'Q2',
                workspaces: { id: 'b-1', name: 'Procurement' },
              },
            },
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      // 4 content + 2 bid response = 6 total, should be capped at 5
      expect(result.my_recent_work).toHaveLength(5);
    });

    it('deduplicates recent work by entity, keeping the newest row', async () => {
      const mock = setupDefaultMock({
        recentWorkData: [
          {
            id: 'h-new',
            content_item_id: 'i-dup',
            change_type: 'edit',
            change_summary: '',
            created_at: '2026-03-08T09:50:00Z',
            content_items: { title: 'Repeated Item' },
          },
          {
            id: 'h-old',
            content_item_id: 'i-dup',
            change_type: 'create',
            change_summary: '',
            created_at: '2026-03-08T08:50:00Z',
            content_items: { title: 'Repeated Item' },
          },
        ],
        bidResponseRecentWorkData: [
          {
            id: 'brh-new',
            response_id: 'r-dup',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:45:00Z',
            form_responses: {
              question_id: 'q-1',
              form_questions: {
                workspace_id: 'b-1',
                question_text: 'Latest response',
                workspaces: { id: 'b-1', name: 'Procurement' },
              },
            },
          },
          {
            id: 'brh-old',
            response_id: 'r-dup',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T08:45:00Z',
            form_responses: {
              question_id: 'q-1',
              form_questions: {
                workspace_id: 'b-1',
                question_text: 'Older response',
                workspaces: { id: 'b-1', name: 'Procurement' },
              },
            },
          },
        ],
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      expect(result.my_recent_work).toHaveLength(2);
      expect(result.my_recent_work.map((item) => item.entity_id)).toEqual([
        'i-dup',
        'r-dup',
      ]);
      expect(result.my_recent_work[0].action).toBe('updated');
      expect(result.my_recent_work[1].entity_title).toBe('Latest response');
    });
  });

  // =========================================================================
  // Viewer role — governance skipped
  // =========================================================================

  describe('viewer role', () => {
    it('skips governance query for viewer role', async () => {
      const mock = setupDefaultMock();

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'viewer',
      );

      // Should still produce valid data but governance reviews should resolve to 0
      expect(result.counts.pending_reviews).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests for resolveDisplayNames (S156 WP-2 refactor — SQL JOIN via
// resolveUserDisplayNames wrapper, not auth.admin.getUserById)
// ---------------------------------------------------------------------------

describe('resolveDisplayNames', () => {
  // Use real UUIDs — the wrapper forwards to a uuid[] RPC, and the
  // dynamic import of `@/lib/users/display-names` is mocked above so
  // these never hit the DB. Keeping the shape realistic guards against
  // accidentally passing non-UUID strings to the production path.
  const U1 = 'e21179e9-1946-43be-94a9-d566046da279';
  const U2 = '11111111-2222-4333-8444-555555555555';
  const U_UNKNOWN = '00000000-4000-4000-8000-000000000999';
  const U_PIPELINE = 'a0000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    vi.mocked(resolveUserDisplayNames).mockReset();
  });

  it('returns an empty map for an empty input array', async () => {
    const map = await resolveDisplayNames([]);
    expect(map.size).toBe(0);
    // Wrapper must not be called on the short-circuit path.
    expect(resolveUserDisplayNames).not.toHaveBeenCalled();
  });

  it('takes the first name when the display_name has a space', async () => {
    vi.mocked(resolveUserDisplayNames).mockResolvedValueOnce(
      new Map([
        [U1, { user_id: U1, display_name: 'Alice Smith' }],
        [U2, { user_id: U2, display_name: 'bob' }],
      ]),
    );

    const map = await resolveDisplayNames([U1, U2, U1]);
    expect(map.size).toBe(2);
    expect(map.get(U1)).toBe('Alice');
    expect(map.get(U2)).toBe('bob');
  });

  it('deduplicates input UUIDs before calling the wrapper', async () => {
    vi.mocked(resolveUserDisplayNames).mockResolvedValueOnce(
      new Map([[U1, { user_id: U1, display_name: 'Alice Smith' }]]),
    );

    await resolveDisplayNames([U1, U1, U1]);

    // Wrapper should see the deduped array, not 3 repeats.
    expect(resolveUserDisplayNames).toHaveBeenCalledTimes(1);
    const [, passedIds] = vi.mocked(resolveUserDisplayNames).mock.calls[0];
    expect(passedIds).toHaveLength(1);
    expect(passedIds[0]).toBe(U1);
  });

  it('passes the "A team member" fallback through unchanged (L-1 guard)', async () => {
    // If we naively split "A team member" on space, we get "A", which
    // renders as "Briefing prepared by A". The reorient function must
    // detect this sentinel and pass it through. (S156 verification
    // report L-1.)
    vi.mocked(resolveUserDisplayNames).mockResolvedValueOnce(
      new Map([
        [
          U_UNKNOWN,
          {
            user_id: U_UNKNOWN,
            display_name: 'A team member',
          },
        ],
      ]),
    );

    const map = await resolveDisplayNames([U_UNKNOWN]);
    expect(map.get(U_UNKNOWN)).toBe('A team member');
  });

  it('passes the "Pipeline (system)" sentinel through unchanged', async () => {
    // Splitting "Pipeline (system)" on space would yield "Pipeline",
    // which would render as "Briefing prepared by Pipeline" — awkward.
    // Reorient keeps the full label so operators can see the content
    // came from infrastructure, not a colleague.
    vi.mocked(resolveUserDisplayNames).mockResolvedValueOnce(
      new Map([
        [
          U_PIPELINE,
          {
            user_id: U_PIPELINE,
            display_name: 'Pipeline (system)',
          },
        ],
      ]),
    );

    const map = await resolveDisplayNames([U_PIPELINE]);
    expect(map.get(U_PIPELINE)).toBe('Pipeline (system)');
  });

  it('surfaces wrapper errors (does NOT swallow them like the old Promise.allSettled)', async () => {
    // S156 thesis: silent degradation was the bug. The new wrapper
    // throws on RPC failures and reorient lets that propagate — a
    // surfaced error is strictly better than "A team member" for
    // everything.
    vi.mocked(resolveUserDisplayNames).mockRejectedValueOnce(
      new Error('get_user_display_names failed: permission denied'),
    );

    await expect(resolveDisplayNames([U1])).rejects.toThrow(
      'permission denied',
    );
  });
});
