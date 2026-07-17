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

vi.mock('@/lib/domains/procurement/procurement-queries', () => ({
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
 * The function structure is (ID-131.19 S450 Wave 1 Fix 4: the content_history
 * "last write" leg and the content_history-sourced team-changes/recent-work
 * legs are RETIRED — content_history drops at M6 and no logical replacement
 * exists; see lib/reorient.ts's retirement comments for the full audit. The
 * read_marks "last read" leg is ALSO RETIRED as of the follow-up commit —
 * read_marks drops at M6 too and had no new-model equivalent; last_active_at
 * now derives solely from auth.last_sign_in_at. Retired legs never issue a
 * from() call — they are Promise.resolve stubs, or simply gone — so they no
 * longer consume a `fromCalls` slot below):
 *   1. Promise.allSettled with 8 items:
 *         [0] team changes — RETIRED, Promise.resolve stub, no from() call.
 *         [1] recent work — RETIRED, Promise.resolve stub, no from() call.
 *         [2] rpc('get_freshness_breakdown')
 *         [3] from('record_lifecycle') or Promise.resolve — governance reviews
 *            (ID-131 {131.19} G-GOV-FACET: content_items retired)
 *         [4] from('ingestion_quality_log') or Promise.resolve — quality flags.
 *            ID-131 {131.19}: get_items_with_quality_flags RPC dropped at M6
 *            — this is now a REAL from() call (only issued when isAdmin),
 *            which shifts every subsequent from() call's positional index by
 *            one for admin-role tests. See `isAdmin` override below.
 *         [5] from('notifications') — unread notifications
 *         [6] from('form_response_history') — bid response team changes
 *         [7] from('form_response_history') — bid response recent work
 *      2. fetchActiveProcurementWithStats (mocked — returns workspaces + statsMap)
 *   Then auth.getUser() for display name
 */
function setupDefaultMock(
  overrides: {
    authUser?: Record<string, unknown> | null;
    workspacesData?: unknown[];
    batchStatsData?: unknown[];
    freshnessData?: unknown[];
    governanceCount?: number;
    qualityFlagsCount?: number;
    notificationsCount?: number;
    bidResponseTeamChangesData?: unknown[];
    bidResponseRecentWorkData?: unknown[];
    /**
     * Whether the test invokes fetchReorientData with isAdmin=true. ID-131
     * {131.19}: the quality-flags branch is a real `.from('ingestion_quality_log')`
     * call only when isAdmin — must be set to true here whenever the test
     * passes isAdmin=true to fetchReorientData, so the positional fromCalls
     * array below inserts the matching slot instead of desyncing every
     * subsequent from() call.
     */
    isAdmin?: boolean;
  } = {},
) {
  const mock = createMockSupabaseClient();

  // Track from() calls sequentially
  const fromCalls: Array<{
    data: unknown;
    error: unknown;
    count: number | null;
  }> = [];

  // Promise.allSettled from() calls (queries 0/1 above — team changes / recent
  // work — are retired Promise.resolve stubs and never call from(), so the
  // FIRST from() call slot is query 3, governance reviews):
  // [3] governance reviews — from('record_lifecycle') (ID-131 {131.19}:
  // content_items retired, governance_review_status now on the facet)
  fromCalls.push({
    data: null,
    error: null,
    count: overrides.governanceCount ?? 0,
  });

  // [4] quality flags — ID-131 {131.19}: get_items_with_quality_flags RPC
  // dropped at M6, replaced with a real from('ingestion_quality_log') call
  // that ONLY fires when isAdmin (mirrors production's `isAdmin ? supabase
  // .from(...) : Promise.resolve(...)`). Only insert this slot when the
  // test will invoke fetchReorientData with isAdmin=true, or every
  // subsequent from() call below desyncs by one position.
  if (overrides.isAdmin) {
    fromCalls.push({
      data: Array.from(
        { length: overrides.qualityFlagsCount ?? 0 },
        (_, i) => ({
          source_document_id: `quality-flag-doc-${i}`,
        }),
      ),
      error: null,
      count: null,
    });
  }

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

  // Configure RPC — freshness breakdown only. ID-131 {131.19}:
  // get_items_with_quality_flags dropped at M6 — quality flags now flow
  // through the from('ingestion_quality_log') slot above, not rpc().
  // (batch stats is handled by the mocked fetchActiveProcurementWithStats)
  mock.rpc.mockImplementation(() =>
    Promise.resolve({
      data: overrides.freshnessData ?? [],
      error: null,
    }),
  );

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

  // ID-131.19 S450 Wave 1 Fix 4 (+ follow-up): both the content_history
  // "last write" leg AND the read_marks "last read" leg are RETIRED
  // (content_history and read_marks both drop at M6; neither has a
  // cross-entity-type equivalent in the new record/facet model) —
  // last_active_at now derives solely from auth.last_sign_in_at, then null.
  describe('last_active_at', () => {
    it('returns last_active_at from last_sign_in_at when present', async () => {
      const mock = setupDefaultMock({
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

    it('falls back to null when no last_sign_in_at available', async () => {
      const mock = setupDefaultMock({
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

  // ID-131.19 S450 Wave 1 Fix 4: the content_history-sourced 'content_item'
  // legs of team_changes/my_recent_work are RETIRED (content_history drops
  // at M6; no logical cross-entity-type replacement exists — see
  // lib/reorient.ts's queries 0/1 retirement comment for the full audit).
  // These blocks replace the previous content_history-seeded assertions
  // (excludes-current-user, change_type→action mapping, item-scoped hrefs),
  // which tested behaviour that no longer exists. The change_type→action
  // mapping itself (mapChangeTypeToAction) is exercised by the surviving
  // 'bid response team changes' / 'bid response recent work' blocks below
  // via their own (hardcoded 'updated'/'edited') actions.
  describe('team_changes', () => {
    it('never produces a content_item-sourced team change (leg retired)', async () => {
      const mock = setupDefaultMock();

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(
        result.team_changes.some((tc) => tc.entity_type === 'content_item'),
      ).toBe(false);
      expect(result.errors).not.toContain('team_changes query failed');
    });
  });

  // =========================================================================
  // Recent work
  // =========================================================================

  describe('my_recent_work', () => {
    it('never produces a content_item-sourced recent-work item (leg retired)', async () => {
      const mock = setupDefaultMock();

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      expect(
        result.my_recent_work.some(
          (item) => item.entity_type === 'content_item',
        ),
      ).toBe(false);
      expect(result.errors).not.toContain('my_recent_work query failed');
    });

    it('returns empty array when no bid response recent work either', async () => {
      const mock = setupDefaultMock({
        bidResponseRecentWorkData: [],
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
      expect(result.urgent[0].type).toBe('procurement_deadline');
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
        isAdmin: true,
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
        isAdmin: true,
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
        isAdmin: true,
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

  describe('forms_summary', () => {
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

      expect(result.forms_summary).toHaveLength(1);
      const bid = result.forms_summary[0];
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

      expect(result.forms_summary).toHaveLength(3);
      // Sorted by deadline urgency: overdue first, then urgent, then normal
      expect(result.forms_summary[0].urgency).toBe('overdue');
      expect(result.forms_summary[1].urgency).toBe('urgent');
      expect(result.forms_summary[2].urgency).toBe('normal');
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

      expect(result.forms_summary[0].name).toBe('Untitled Procurement');
      expect(result.forms_summary[0].status).toBe('draft');
      expect(result.forms_summary[0].buyer).toBeNull();
    });
  });

  // =========================================================================
  // Partial query failures
  // =========================================================================

  describe('handles partial query failures gracefully', () => {
    // ID-131.19 S450 Wave 1 Fix 4: team_changes/my_recent_work's
    // content_history legs are RETIRED — Promise.resolve stubs that can
    // never fail — so the "team changes query fails" scenario this test
    // used to construct via a real erroring from() call is no longer
    // reachable. Replaced with the accurate, opposite assertion: these two
    // legs NEVER surface a query-failure error, regardless of what real
    // queries elsewhere in the same batch do.
    it('team_changes and my_recent_work never surface a query-failure error (legs retired)', async () => {
      const mock = setupDefaultMock();

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        false,
        'editor',
      );

      // Should still return a valid result
      expect(result.team_changes).toEqual([]);
      expect(result.my_recent_work).toEqual([]);
      expect(result.errors).not.toContain('team_changes query failed');
      expect(result.errors).not.toContain('my_recent_work query failed');
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
        isAdmin: true,
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
        bidResponseTeamChangesData: [
          {
            id: 'brh-1',
            response_id: 'resp-1',
            edited_by: 'other-user-2',
            created_at: '2026-03-08T09:30:00Z',
            form_responses: {
              question_id: 'q-1',
              form_questions: {
                form_instance_id: 'bid-1',
                form_instances: {
                  name: 'NHS Digital Procurement',
                  issuing_organisation: null,
                },
              },
            },
          },
        ],
        isAdmin: true,
      });

      // Use admin role to ensure all from() calls fire in sequential mock order
      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      // ID-131.19 S450 Wave 1 Fix 4: only ONE entry now — the
      // content_history-sourced 'content_item' leg this test used to also
      // seed is retired.
      expect(result.team_changes).toHaveLength(1);
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

    it('sorts multiple bid response team changes by date descending', async () => {
      // ID-131.19 S450 Wave 1 Fix 4: rewritten to use TWO bid-response
      // entries (the content_item comparison entry this test used to seed
      // via teamChangesData is retired) — still proves the sort-by-date
      // behaviour over the surviving single-source data.
      const mock = setupDefaultMock({
        bidResponseTeamChangesData: [
          {
            id: 'brh-older',
            response_id: 'resp-older',
            edited_by: 'other-user-1',
            created_at: '2026-03-08T08:00:00Z',
            form_responses: {
              question_id: 'q-1',
              form_questions: {
                form_instance_id: 'bid-1',
                form_instances: {
                  name: 'Old Procurement',
                  issuing_organisation: null,
                },
              },
            },
          },
          {
            id: 'brh-recent',
            response_id: 'resp-recent',
            edited_by: 'other-user-2',
            created_at: '2026-03-08T09:00:00Z',
            form_responses: {
              question_id: 'q-2',
              form_questions: {
                form_instance_id: 'bid-1',
                form_instances: {
                  name: 'Recent Procurement',
                  issuing_organisation: null,
                },
              },
            },
          },
        ],
        isAdmin: true,
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      // Recent Procurement (09:00) should come before Old Procurement (08:00)
      expect(result.team_changes).toHaveLength(2);
      expect(result.team_changes[0].entity_title).toBe('Recent Procurement');
      expect(result.team_changes[1].entity_title).toBe('Old Procurement');
    });
  });

  // =========================================================================
  // Procurement response recent work
  // =========================================================================

  describe('bid response recent work', () => {
    it('includes bid response edits in my_recent_work', async () => {
      const mock = setupDefaultMock({
        bidResponseRecentWorkData: [
          {
            id: 'brh-own-1',
            response_id: 'resp-2',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:15:00Z',
            form_responses: {
              question_id: 'q-2',
              form_questions: {
                form_instance_id: 'bid-2',
                question_text: 'Describe your security approach',
              },
            },
          },
        ],
        isAdmin: true,
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
        bidResponseRecentWorkData: [
          {
            id: 'brh-own-2',
            response_id: 'resp-3',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:00:00Z',
            form_responses: {
              question_id: 'q-3',
              form_questions: {
                form_instance_id: 'bid-3',
                question_text: longQuestion,
              },
            },
          },
        ],
        isAdmin: true,
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

    it('limits recent work to 5 items', async () => {
      // ID-131.19 S450 Wave 1 Fix 4: re-seeded via bidResponseRecentWorkData
      // only — the content_history leg that used to supply the other 4
      // entries is retired, but the 5-item cap logic
      // (dedupeRecentWorkByEntity(...).slice(0, 5)) still applies to
      // whatever the surviving source produces.
      const mock = setupDefaultMock({
        bidResponseRecentWorkData: [
          {
            id: 'brh-1',
            response_id: 'r-1',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:50:00Z',
            form_responses: {
              question_id: 'q-1',
              form_questions: {
                form_instance_id: 'b-1',
                question_text: 'Q1',
              },
            },
          },
          {
            id: 'brh-2',
            response_id: 'r-2',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:40:00Z',
            form_responses: {
              question_id: 'q-2',
              form_questions: {
                form_instance_id: 'b-1',
                question_text: 'Q2',
              },
            },
          },
          {
            id: 'brh-3',
            response_id: 'r-3',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:30:00Z',
            form_responses: {
              question_id: 'q-3',
              form_questions: {
                form_instance_id: 'b-1',
                question_text: 'Q3',
              },
            },
          },
          {
            id: 'brh-4',
            response_id: 'r-4',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:20:00Z',
            form_responses: {
              question_id: 'q-4',
              form_questions: {
                form_instance_id: 'b-1',
                question_text: 'Q4',
              },
            },
          },
          {
            id: 'brh-5',
            response_id: 'r-5',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:10:00Z',
            form_responses: {
              question_id: 'q-5',
              form_questions: {
                form_instance_id: 'b-1',
                question_text: 'Q5',
              },
            },
          },
          {
            id: 'brh-6',
            response_id: 'r-6',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:00:00Z',
            form_responses: {
              question_id: 'q-6',
              form_questions: {
                form_instance_id: 'b-1',
                question_text: 'Q6',
              },
            },
          },
        ],
        isAdmin: true,
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      // 6 bid response entries, should be capped at 5
      expect(result.my_recent_work).toHaveLength(5);
    });

    it('deduplicates recent work by entity, keeping the newest row', async () => {
      // ID-131.19 S450 Wave 1 Fix 4: rewritten to use ONLY
      // form_response_history duplicates (the content_history leg that used
      // to supply the other duplicate group is retired) — two distinct
      // bid-response entities, one of which has two revisions, proves
      // dedup-by-entity + sort-by-date still work over the surviving
      // single-source data.
      const mock = setupDefaultMock({
        bidResponseRecentWorkData: [
          {
            id: 'brh-new',
            response_id: 'r-dup',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T09:45:00Z',
            form_responses: {
              question_id: 'q-1',
              form_questions: {
                form_instance_id: 'b-1',
                question_text: 'Latest response',
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
                form_instance_id: 'b-1',
                question_text: 'Older response',
              },
            },
          },
          {
            id: 'brh-other',
            response_id: 'r-other',
            edited_by: TEST_USER_ID,
            created_at: '2026-03-08T08:50:00Z',
            form_responses: {
              question_id: 'q-2',
              form_questions: {
                form_instance_id: 'b-1',
                question_text: 'A different response',
              },
            },
          },
        ],
        isAdmin: true,
      });

      const result = await fetchReorientData(
        mock as unknown as Parameters<typeof fetchReorientData>[0],
        TEST_USER_ID,
        true,
        'admin',
      );

      expect(result.my_recent_work).toHaveLength(2);
      expect(result.my_recent_work.map((item) => item.entity_id)).toEqual([
        'r-dup',
        'r-other',
      ]);
      expect(result.my_recent_work[0].entity_title).toBe('Latest response');
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
