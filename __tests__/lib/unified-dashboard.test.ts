/**
 * Unit tests for fetchUnifiedDashboardData() in lib/dashboard.ts.
 *
 * Tests the unified fetch that combines fetchDashboardData + fetchReorientData
 * into a single function, eliminating 4 duplicate queries (freshness,
 * governance reviews, notifications, active bids).
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

vi.mock('@/lib/format', () => ({
  formatRelativeDate: vi.fn((date: string | null) => {
    if (!date) return '';
    return '2 hours ago';
  }),
}));

const mockActiveBidsResult = vi.hoisted(() => ({
  current: {
    workspaces: [] as unknown[],
    statsMap: new Map<string, unknown>(),
  },
}));

vi.mock('@/lib/bid-queries', () => ({
  fetchActiveBidsWithStats: vi.fn(() =>
    Promise.resolve(mockActiveBidsResult.current),
  ),
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------

import { fetchUnifiedDashboardData } from '@/lib/dashboard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-abc-123';

/**
 * Configure the mock Supabase client for fetchUnifiedDashboardData.
 *
 * Query structure:
 *   Phase 1 (last activity):
 *     from(0): content_history — last write activity
 *     from(1): read_marks — last read activity
 *   Phase 2 (main parallel batch):
 *     Promise.allSettled with 11 items:
 *       [0] governance reviews — from('content_items') or Promise.resolve for viewer
 *       [1] unverified items — from('content_items')
 *       [2] quality flags — rpc('get_items_with_quality_flags') or Promise.resolve
 *       [3] freshness breakdown — rpc('get_freshness_breakdown')
 *       [4] unread notifications — from('notifications')
 *       [5] recent activity — rpc('get_grouped_activity_feed')
 *       [6] team changes (content_history) — from('content_history')
 *       [7] recent work (content_history) — from('content_history')
 *       [8] bid response team changes — from('bid_response_history')
 *       [9] bid response recent work — from('bid_response_history')
 *       [10] expiring content dates — from('content_items')
 *     fetchActiveBidsWithStats (mocked separately)
 *   auth.getUser() for display name
 */
function setupDefaultMock(overrides: {
  lastActivityData?: unknown[];
  lastReadActivityData?: unknown[];
  authUser?: Record<string, unknown> | null;
  teamChangesData?: unknown[];
  recentWorkData?: unknown[];
  freshnessData?: unknown[];
  governanceCount?: number;
  notificationsCount?: number;
  qualityFlagsData?: unknown[];
  bidResponseTeamChangesData?: unknown[];
  bidResponseRecentWorkData?: unknown[];
  unverifiedCount?: number;
  expiringContentDateCount?: number;
  activityFeedData?: unknown[];
  workspaces?: unknown[];
  statsMap?: Map<string, unknown>;
} = {}) {
  const mock = createMockSupabaseClient();

  // Track from() calls sequentially
  const fromCalls: Array<{
    data: unknown;
    error: unknown;
    count: number | null;
  }> = [];

  // Phase 1: last activity queries
  // Call 0: content_history for lastActivity (write)
  fromCalls.push({
    data: overrides.lastActivityData ?? [{ created_at: '2026-03-08T08:00:00Z' }],
    error: null,
    count: null,
  });

  // Call 1: read_marks for lastActivity (read)
  fromCalls.push({
    data: overrides.lastReadActivityData ?? [],
    error: null,
    count: null,
  });

  // Phase 2: main parallel batch from() calls
  // [0] governance reviews — from('content_items')
  fromCalls.push({
    data: null,
    error: null,
    count: overrides.governanceCount ?? 0,
  });

  // [1] unverified items — from('content_items')
  fromCalls.push({
    data: null,
    error: null,
    count: overrides.unverifiedCount ?? 0,
  });

  // [4] unread notifications — from('notifications')
  fromCalls.push({
    data: null,
    error: null,
    count: overrides.notificationsCount ?? 0,
  });

  // [6] team changes — from('content_history')
  fromCalls.push({
    data: overrides.teamChangesData ?? [],
    error: null,
    count: null,
  });

  // [7] recent work — from('content_history')
  fromCalls.push({
    data: overrides.recentWorkData ?? [],
    error: null,
    count: null,
  });

  // [8] bid response team changes — from('bid_response_history')
  fromCalls.push({
    data: overrides.bidResponseTeamChangesData ?? [],
    error: null,
    count: null,
  });

  // [9] bid response recent work — from('bid_response_history')
  fromCalls.push({
    data: overrides.bidResponseRecentWorkData ?? [],
    error: null,
    count: null,
  });

  // [10] expiring content dates — from('content_items')
  fromCalls.push({
    data: null,
    error: null,
    count: overrides.expiringContentDateCount ?? 0,
  });

  // Configure from() to return per-call chain
  let callIdx = 0;
  mock.from.mockImplementation(() => {
    const idx = callIdx++;
    const response = fromCalls[idx] ?? { data: [], error: null, count: 0 };

    const freshChain: Record<string, ReturnType<typeof vi.fn>> = {};

    for (const key of Object.keys(mock._chain)) {
      if (key === 'then' || key === 'single' || key === 'maybeSingle' || key === 'csv') {
        continue;
      }
      freshChain[key] = vi.fn().mockReturnValue(freshChain);
    }

    freshChain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: response.data, error: response.error, count: response.count }),
    );
    freshChain.single = vi.fn().mockResolvedValue({
      data: response.data,
      error: response.error,
      count: response.count,
    });
    freshChain.maybeSingle = vi.fn().mockResolvedValue({
      data: response.data,
      error: response.error,
    });

    return freshChain;
  });

  // Configure rpc() calls — 3 RPCs in order:
  // [2] get_items_with_quality_flags, [3] get_freshness_breakdown, [5] get_grouped_activity_feed
  let rpcIdx = 0;
  const rpcResponses = [
    // [2] quality flags
    { data: overrides.qualityFlagsData ?? [], error: null },
    // [3] freshness breakdown
    {
      data: overrides.freshnessData ?? [
        { freshness: 'fresh', count: 10 },
        { freshness: 'aging', count: 5 },
        { freshness: 'stale', count: 3 },
        { freshness: 'expired', count: 2 },
      ],
      error: null,
    },
    // [5] recent activity
    { data: overrides.activityFeedData ?? [], error: null },
  ];

  mock.rpc.mockImplementation(() => {
    const idx = rpcIdx++;
    const response = rpcResponses[idx] ?? { data: null, error: null };
    return Promise.resolve(response);
  });

  // Configure auth
  const defaultAuthUser = overrides.authUser !== undefined
    ? overrides.authUser
    : {
        id: TEST_USER_ID,
        email: 'liam@example.com',
        user_metadata: { display_name: 'Liam' },
      };

  mock.auth.getUser.mockResolvedValue({
    data: { user: defaultAuthUser },
    error: null,
  });

  // Configure bid mock
  if (overrides.workspaces || overrides.statsMap) {
    mockActiveBidsResult.current = {
      workspaces: overrides.workspaces ?? [],
      statsMap: overrides.statsMap ?? new Map(),
    };
  } else {
    mockActiveBidsResult.current = {
      workspaces: [],
      statsMap: new Map(),
    };
  }

  return mock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchUnifiedDashboardData', () => {
  beforeEach(() => {
    mockActiveBidsResult.current = {
      workspaces: [],
      statsMap: new Map(),
    };
  });

  it('returns all expected top-level fields', async () => {
    const mock = setupDefaultMock();
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result).toHaveProperty('attention_sources');
    expect(result).toHaveProperty('active_bids');
    expect(result).toHaveProperty('freshness_summary');
    expect(result).toHaveProperty('reorient');
    expect(result).toHaveProperty('recent_activity');
    expect(result).toHaveProperty('user_role');
    expect(result).toHaveProperty('errors');
  });

  it('returns all expected attention_sources fields', async () => {
    const mock = setupDefaultMock({
      governanceCount: 4,
      unverifiedCount: 7,
      notificationsCount: 3,
      expiringContentDateCount: 2,
    });
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    const sources = result.attention_sources;
    expect(sources.governance_review_count).toBe(4);
    expect(sources.unverified_count).toBe(7);
    expect(sources.unread_notification_count).toBe(3);
    expect(sources.expiring_content_date_count).toBe(2);
    // Hardcoded TODOs
    expect(sources.expiring_cert_count).toBe(0);
    expect(sources.coverage_gap_count).toBe(0);
  });

  it('populates freshness summary from RPC data', async () => {
    const mock = setupDefaultMock({
      freshnessData: [
        { freshness: 'fresh', count: 20 },
        { freshness: 'aging', count: 8 },
        { freshness: 'stale', count: 4 },
        { freshness: 'expired', count: 1 },
      ],
    });
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.freshness_summary).toEqual({
      fresh: 20,
      aging: 8,
      stale: 4,
      expired: 1,
    });
    // stale + expired should also feed attention_sources
    expect(result.attention_sources.stale_content_count).toBe(4);
    expect(result.attention_sources.expired_content_count).toBe(1);
  });

  it('handles partial query failures gracefully with error tracking', async () => {
    const mock = setupDefaultMock();

    // Make freshness RPC fail
    let rpcIdx = 0;
    mock.rpc.mockImplementation(() => {
      const idx = rpcIdx++;
      if (idx === 1) {
        // freshness breakdown
        return Promise.resolve({ data: null, error: { message: 'DB error' } });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.errors).toContain('freshness_breakdown query failed');
    // Freshness should be zeroes
    expect(result.freshness_summary).toEqual({ fresh: 0, aging: 0, stale: 0, expired: 0 });
  });

  it('admin sees quality flags count', async () => {
    const mock = setupDefaultMock({
      qualityFlagsData: [{ id: '1' }, { id: '2' }, { id: '3' }],
    });
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true, // isAdmin
      'admin',
    );

    expect(result.attention_sources.quality_flag_count).toBe(3);
  });

  it('non-admin gets zero quality flags', async () => {
    const mock = setupDefaultMock();
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      false, // not admin
      'editor',
    );

    expect(result.attention_sources.quality_flag_count).toBe(0);
  });

  it('viewer role skips governance query (returns zero)', async () => {
    const mock = setupDefaultMock({
      governanceCount: 99, // Should be ignored for viewer
    });
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      false,
      'viewer',
    );

    // Viewer uses Promise.resolve({ count: 0 }) instead of querying
    expect(result.attention_sources.governance_review_count).toBe(0);
  });

  it('active bids sorted by deadline urgency (most urgent first)', async () => {
    const statsMap = new Map();
    statsMap.set('bid-1', { total_questions: 10, drafted_count: 5, complete_count: 2 });
    statsMap.set('bid-2', { total_questions: 8, drafted_count: 3, complete_count: 1 });
    statsMap.set('bid-3', { total_questions: 6, drafted_count: 2, complete_count: 0 });

    const mock = setupDefaultMock({
      workspaces: [
        {
          id: 'bid-1',
          name: 'Normal Bid',
          domain_metadata: { deadline: '2026-04-01T00:00:00Z', buyer: 'Acme', status: 'in_progress' },
          is_archived: false,
          created_at: '2026-01-01',
          updated_at: '2026-03-01',
        },
        {
          id: 'bid-2',
          name: 'Overdue Bid',
          domain_metadata: { deadline: '2026-03-01T00:00:00Z', buyer: 'Corp', status: 'in_progress' },
          is_archived: false,
          created_at: '2026-01-01',
          updated_at: '2026-03-01',
        },
        {
          id: 'bid-3',
          name: 'Urgent Bid',
          domain_metadata: { deadline: '2026-03-09T00:00:00Z', buyer: 'Ltd', status: 'in_progress' },
          is_archived: false,
          created_at: '2026-01-01',
          updated_at: '2026-03-01',
        },
      ],
      statsMap,
    });

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.active_bids.length).toBe(3);
    // Overdue (bid-2) < Urgent (bid-3) < Normal (bid-1)
    expect(result.active_bids[0].id).toBe('bid-2');
    expect(result.active_bids[1].id).toBe('bid-3');
    expect(result.active_bids[2].id).toBe('bid-1');
  });

  it('reorient personal data includes display name and last active', async () => {
    const mock = setupDefaultMock({
      authUser: {
        id: TEST_USER_ID,
        email: 'liam@example.com',
        user_metadata: { display_name: 'Liam Jones' },
      },
      lastActivityData: [{ created_at: '2026-03-08T08:00:00Z' }],
    });

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.reorient.user_display_name).toBe('Liam');
    expect(result.reorient.has_display_name).toBe(true);
    expect(result.reorient.last_active_at).toBe('2026-03-08T08:00:00Z');
    expect(result.reorient.last_active_relative).toBe('2 hours ago');
  });

  it('reorient includes team changes from content_history', async () => {
    const mock = setupDefaultMock({
      teamChangesData: [
        {
          id: 'ch-1',
          content_item_id: 'item-1',
          change_type: 'edit',
          change_summary: 'Updated title',
          created_by: 'other-user',
          created_at: '2026-03-08T09:00:00Z',
          content_items: { title: 'Some Article', primary_domain: 'compliance' },
        },
      ],
    });

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.reorient.team_changes.length).toBe(1);
    expect(result.reorient.team_changes[0].entity_type).toBe('content_item');
    expect(result.reorient.team_changes[0].entity_title).toBe('Some Article');
    expect(result.reorient.team_changes[0].action).toBe('updated');
  });

  it('reorient includes my_recent_work from content_history', async () => {
    const mock = setupDefaultMock({
      recentWorkData: [
        {
          id: 'ch-2',
          content_item_id: 'item-2',
          change_type: 'create',
          change_summary: 'Created article',
          created_at: '2026-03-08T07:00:00Z',
          content_items: { title: 'My New Article' },
        },
      ],
    });

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.reorient.my_recent_work.length).toBe(1);
    expect(result.reorient.my_recent_work[0].entity_type).toBe('content_item');
    expect(result.reorient.my_recent_work[0].entity_title).toBe('My New Article');
    expect(result.reorient.my_recent_work[0].action).toBe('created');
    expect(result.reorient.my_recent_work[0].href).toBe('/item/item-2');
  });

  it('error array tracks multiple failed queries independently', async () => {
    const mock = setupDefaultMock();

    // Make multiple RPCs fail
    let rpcIdx = 0;
    mock.rpc.mockImplementation(() => {
      const idx = rpcIdx++;
      if (idx === 0) {
        // quality flags
        return Promise.resolve({ data: null, error: { message: 'quality fail' } });
      }
      if (idx === 1) {
        // freshness
        return Promise.resolve({ data: null, error: { message: 'freshness fail' } });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true, // isAdmin — so quality flags RPC runs
      'admin',
    );

    expect(result.errors).toContain('quality_flag_count query failed');
    expect(result.errors).toContain('freshness_breakdown query failed');
  });

  it('defaults role to viewer when not provided', async () => {
    const mock = setupDefaultMock();
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      false,
      // role omitted
    );

    expect(result.user_role).toBe('viewer');
  });

  it('uses email fallback for display name when no display_name metadata', async () => {
    const mock = setupDefaultMock({
      authUser: {
        id: TEST_USER_ID,
        email: 'john.smith@example.com',
        user_metadata: {},
      },
    });

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      false,
      'editor',
    );

    // Email prefix 'john.smith' -> 'john smith' -> 'John smith' (title case first word)
    expect(result.reorient.user_display_name).toBe('John smith');
    expect(result.reorient.has_display_name).toBe(false);
  });

  it('reorient bid_summary is populated from active bids data', async () => {
    const statsMap = new Map();
    statsMap.set('bid-x', {
      total_questions: 12,
      drafted_count: 6,
      complete_count: 3,
      needs_sme_count: 2,
      no_content_count: 1,
    });

    const mock = setupDefaultMock({
      workspaces: [
        {
          id: 'bid-x',
          name: 'Test Tender',
          domain_metadata: { deadline: '2026-03-20T00:00:00Z', buyer: 'BigCo', status: 'in_progress' },
          is_archived: false,
          created_at: '2026-01-01',
          updated_at: '2026-03-01',
        },
      ],
      statsMap,
    });

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.reorient.bid_summary.length).toBe(1);
    const bid = result.reorient.bid_summary[0];
    expect(bid.name).toBe('Test Tender');
    expect(bid.buyer).toBe('BigCo');
    expect(bid.total_questions).toBe(12);
    expect(bid.answered_questions).toBe(9); // 6 drafted + 3 complete
    expect(bid.approved_questions).toBe(3);
    expect(bid.gap_count).toBe(3); // 2 needs_sme + 1 no_content
    expect(bid.href).toBe('/bid/bid-x');
  });

  it('returns empty arrays when no data exists', async () => {
    const mock = setupDefaultMock({
      teamChangesData: [],
      recentWorkData: [],
      activityFeedData: [],
    });

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.active_bids).toEqual([]);
    expect(result.recent_activity).toEqual([]);
    expect(result.reorient.team_changes).toEqual([]);
    expect(result.reorient.my_recent_work).toEqual([]);
    expect(result.reorient.bid_summary).toEqual([]);
  });

  it('limits my_recent_work to 5 items', async () => {
    const mock = setupDefaultMock({
      recentWorkData: Array.from({ length: 8 }, (_, i) => ({
        id: `ch-${i}`,
        content_item_id: `item-${i}`,
        change_type: 'edit',
        change_summary: `Edit ${i}`,
        created_at: new Date(Date.now() - i * 3600000).toISOString(),
        content_items: { title: `Article ${i}` },
      })),
    });

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.reorient.my_recent_work.length).toBeLessThanOrEqual(5);
  });
});
