/**
 * Unit tests for fetchUnifiedDashboardData() in lib/dashboard.ts.
 *
 * Tests the unified fetch that combines dashboard + reorient queries
 * into a single function, eliminating duplicate queries (freshness,
 * governance reviews, notifications, active procurements).
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

vi.mock('@/lib/domains/procurement/procurement-queries', () => ({
  fetchActiveProcurementWithStats: vi.fn(() =>
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
 * Query structure (ID-131.19 S450 Wave 1 Fix 4: the content_history "last
 * write" leg and the content_history-sourced team-changes/recent-work legs
 * are RETIRED — content_history drops at M6 and no logical replacement
 * exists; see lib/dashboard.ts's retirement comments for the full audit.
 * Retired legs never issue a from() call — they are Promise.resolve stubs —
 * so they no longer consume a `fromCalls` slot below):
 *   Phase 1 (last activity + cert relationships):
 *     from(0): read_marks — last read activity
 *     from(1): entity_relationships — cert relationship targets
 *   Phase 2 (main parallel batch):
 *     Promise.allSettled with 7 items:
 *       [0] attention counts — rpc('get_dashboard_attention_counts')
 *       [1] recent activity — ID-131 {131.19}: get_grouped_activity_feed RPC
 *           dropped at M6 (content_items-anchored) — this leg is now always
 *           Promise.resolve({data: [], error: null}), never rpc(). Only ONE
 *           rpc() call fires per invocation now (attention counts).
 *       [2] team changes — RETIRED, Promise.resolve stub, no from() call.
 *       [3] recent work — RETIRED, Promise.resolve stub, no from() call.
 *       [4] bid response team changes — from('form_response_history')
 *       [5] bid response recent work — from('form_response_history')
 *       [6] cert expiry — from('entity_mentions') or Promise.resolve
 *     fetchActiveProcurementWithStats (mocked separately)
 *   auth.getUser() for display name
 */
function setupDefaultMock(
  overrides: {
    lastReadActivityData?: unknown[];
    certRelData?: unknown[];
    authUser?: Record<string, unknown> | null;
    freshnessData?: {
      fresh: number;
      aging: number;
      stale: number;
      expired: number;
    };
    governanceCount?: number;
    notificationsCount?: number;
    qualityFlagsCount?: number;
    bidResponseTeamChangesData?: unknown[];
    bidResponseRecentWorkData?: unknown[];
    unverifiedCount?: number;
    expiringContentDateCount?: number;
    certMentionsData?: unknown[];
    unclassifiedCount?: number;
    activityFeedData?: unknown[];
    workspaces?: unknown[];
    statsMap?: Map<string, unknown>;
  } = {},
) {
  const mock = createMockSupabaseClient();

  // Track from() calls sequentially
  const fromCalls: Array<{
    data: unknown;
    error: unknown;
    count: number | null;
  }> = [];

  // Phase 1: last activity + cert relationships
  // Call 0: read_marks for lastActivity (read)
  fromCalls.push({
    data: overrides.lastReadActivityData ?? [],
    error: null,
    count: null,
  });

  // Call 1: entity_relationships for cert targets
  fromCalls.push({
    data: overrides.certRelData ?? [],
    error: null,
    count: null,
  });

  // Phase 2: from() calls (queries 4-6 in Promise.allSettled — queries 2/3
  // are the retired content_history stubs and never call from())
  // [4] bid response team changes — from('form_response_history')
  fromCalls.push({
    data: overrides.bidResponseTeamChangesData ?? [],
    error: null,
    count: null,
  });

  // [5] bid response recent work — from('form_response_history')
  fromCalls.push({
    data: overrides.bidResponseRecentWorkData ?? [],
    error: null,
    count: null,
  });

  // [6] cert expiry — from('entity_mentions')
  // When certRelData is empty, query 6 uses Promise.resolve so no from() call.
  // When certRelData has data, the from('entity_mentions') call happens.
  if (overrides.certRelData && overrides.certRelData.length > 0) {
    fromCalls.push({
      data: overrides.certMentionsData ?? [],
      error: null,
      count: null,
    });
  }

  // [7] taxonomy-coverage gap (ID-63.12) — from('source_documents') head:true +
  // count:'exact'. Always issued (no Promise.resolve short-circuit), so it
  // always consumes the next from() call slot.
  fromCalls.push({
    data: null,
    error: null,
    count: overrides.unclassifiedCount ?? 0,
  });

  // Configure from() to return per-call chain
  let callIdx = 0;
  mock.from.mockImplementation(() => {
    const idx = callIdx++;
    const response = fromCalls[idx] ?? { data: [], error: null, count: 0 };

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
      freshChain[key] = vi.fn().mockReturnValue(freshChain);
    }

    freshChain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({
        data: response.data,
        error: response.error,
        count: response.count,
      }),
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

  // Build default freshness summary
  const defaultFreshness = overrides.freshnessData ?? {
    fresh: 10,
    aging: 5,
    stale: 3,
    expired: 2,
  };

  // Configure rpc() calls — 2 RPCs in order:
  // [0] get_dashboard_attention_counts, [1] get_grouped_activity_feed
  let rpcIdx = 0;
  const rpcResponses = [
    // [0] attention counts — ID-70: RETURNS TABLE → a single-row array; the
    // consumer reads data[0] and Zod-parses the freshness_summary jsonb column.
    {
      data: [
        {
          governance_review_count: overrides.governanceCount ?? 0,
          unverified_count: overrides.unverifiedCount ?? 0,
          quality_flag_count: overrides.qualityFlagsCount ?? 0,
          stale_content_count: defaultFreshness.stale,
          expired_content_count: defaultFreshness.expired,
          expiring_content_date_count: overrides.expiringContentDateCount ?? 0,
          unread_notification_count: overrides.notificationsCount ?? 0,
          // coverage_gap_count RETIRED (ID-131.19 S450 Wave 1 Fix 1, DR-034)
          // — no longer part of the RPC's RETURNS TABLE shape.
          freshness_summary: defaultFreshness,
        },
      ],
      error: null,
    },
    // [1] recent activity
    { data: overrides.activityFeedData ?? [], error: null },
  ];

  mock.rpc.mockImplementation(() => {
    const idx = rpcIdx++;
    const response = rpcResponses[idx] ?? { data: null, error: null };
    return Promise.resolve(response);
  });

  // Configure auth
  const defaultAuthUser =
    overrides.authUser !== undefined
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
    // Cert and coverage counts are now wired server-side
    expect(sources.expiring_cert_count).toBe(0); // No cert relationship data in default mock
    // coverage_gap_count RETIRED (ID-131.19 S450 Wave 1 Fix 1, DR-034) — no
    // longer a field on attention_sources at all.
    expect(sources).not.toHaveProperty('coverage_gap_count');
  });

  // ID-63.12 — taxonomy-coverage gap count flows from the new
  // content_items 'unclassified' sentinel count query into attention_sources.
  it('surfaces the unclassified taxonomy-coverage count in attention_sources', async () => {
    const mock = setupDefaultMock({ unclassifiedCount: 6 });
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.attention_sources.unclassified_count).toBe(6);
    // ID-131 {131.19} G-GOV-FACET: content_items is dying — the sentinel
    // columns (primary_domain/primary_subtopic/archived_at) now live on
    // source_documents, so the query must run against that table.
    expect(mock.from).toHaveBeenCalledWith('source_documents');
    expect(result.errors).not.toContain('unclassified_count query failed');
  });

  it('defaults unclassified_count to 0 when nothing is unclassified', async () => {
    const mock = setupDefaultMock();
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.attention_sources.unclassified_count).toBe(0);
  });

  it('populates freshness summary from RPC data', async () => {
    const mock = setupDefaultMock({
      freshnessData: { fresh: 20, aging: 8, stale: 4, expired: 1 },
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

    // Make the attention counts RPC fail
    let rpcIdx = 0;
    mock.rpc.mockImplementation(() => {
      const idx = rpcIdx++;
      if (idx === 0) {
        // attention counts RPC
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

    expect(result.errors).toContain('attention_counts RPC failed');
    // Freshness should be zeroes when RPC fails
    expect(result.freshness_summary).toEqual({
      fresh: 0,
      aging: 0,
      stale: 0,
      expired: 0,
    });
  });

  it('admin sees quality flags count', async () => {
    const mock = setupDefaultMock({
      qualityFlagsCount: 3,
    });
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true, // isAdmin
      'admin',
    );

    expect(result.attention_sources.quality_flag_count).toBe(3);
  });

  it('non-admin gets zero quality flags (RPC handles role filtering)', async () => {
    // The RPC itself returns 0 for quality_flag_count when role is not admin/editor
    const mock = setupDefaultMock({
      qualityFlagsCount: 0,
    });
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      false, // not admin
      'editor',
    );

    expect(result.attention_sources.quality_flag_count).toBe(0);
  });

  it('viewer role gets zero governance count from RPC', async () => {
    // The RPC returns 0 for governance_review_count when role is 'viewer'
    const mock = setupDefaultMock({
      governanceCount: 0, // RPC returns 0 for viewer
    });
    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      false,
      'viewer',
    );

    expect(result.attention_sources.governance_review_count).toBe(0);
  });

  it('active procurements sorted by deadline urgency (most urgent first)', async () => {
    const statsMap = new Map();
    statsMap.set('bid-1', {
      total_questions: 10,
      drafted_count: 5,
      complete_count: 2,
    });
    statsMap.set('bid-2', {
      total_questions: 8,
      drafted_count: 3,
      complete_count: 1,
    });
    statsMap.set('bid-3', {
      total_questions: 6,
      drafted_count: 2,
      complete_count: 0,
    });

    const mock = setupDefaultMock({
      workspaces: [
        {
          id: 'bid-1',
          name: 'Normal Procurement',
          domain_metadata: {
            deadline: '2026-04-01T00:00:00Z',
            buyer: 'Acme',
            status: 'in_progress',
          },
          is_archived: false,
          created_at: '2026-01-01',
          updated_at: '2026-03-01',
        },
        {
          id: 'bid-2',
          name: 'Overdue Procurement',
          domain_metadata: {
            deadline: '2026-03-01T00:00:00Z',
            buyer: 'Corp',
            status: 'in_progress',
          },
          is_archived: false,
          created_at: '2026-01-01',
          updated_at: '2026-03-01',
        },
        {
          id: 'bid-3',
          name: 'Urgent Procurement',
          domain_metadata: {
            deadline: '2026-03-09T00:00:00Z',
            buyer: 'Ltd',
            status: 'in_progress',
          },
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
      // ID-131.19 S450 Wave 1 Fix 4: last_active_at now derives from
      // read_marks only (the content_history write leg is retired).
      lastReadActivityData: [{ read_at: '2026-03-08T08:00:00Z' }],
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

  // ID-131.19 S450 Wave 1 Fix 4: the content_history-sourced 'content_item'
  // legs of team_changes/my_recent_work are RETIRED (content_history drops
  // at M6; no logical cross-entity-type replacement exists — see
  // lib/dashboard.ts's query-2/3 retirement comment for the full audit).
  // These two tests replace 'reorient includes team changes from
  // content_history' / 'reorient includes my_recent_work from
  // content_history', which asserted behaviour that no longer exists.
  it('never produces a content_item-sourced team change (leg retired)', async () => {
    const mock = setupDefaultMock();

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(
      result.reorient.team_changes.some(
        (tc) => tc.entity_type === 'content_item',
      ),
    ).toBe(false);
    expect(result.errors).not.toContain('team_changes query failed');
  });

  it('never produces a content_item-sourced recent-work item (leg retired)', async () => {
    const mock = setupDefaultMock();

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(
      result.reorient.my_recent_work.some(
        (item) => item.entity_type === 'content_item',
      ),
    ).toBe(false);
    expect(result.errors).not.toContain('my_recent_work query failed');
  });

  it('deduplicates my_recent_work by entity, keeping the latest activity', async () => {
    // ID-131.19 S450 Wave 1 Fix 4: rewritten to use ONLY form_response_history
    // duplicates (the content_history leg that used to supply the other
    // duplicate group is retired) — two distinct bid-response entities, one
    // of which has two revisions, proves dedup-by-entity + sort-by-date
    // still work over the surviving single-source data.
    const mock = setupDefaultMock({
      bidResponseRecentWorkData: [
        {
          id: 'brh-new',
          response_id: 'response-dup',
          edited_by: TEST_USER_ID,
          created_at: '2026-03-08T09:30:00Z',
          form_responses: {
            question_id: 'q-1',
            form_questions: {
              workspace_id: 'bid-1',
              question_text: 'Latest answer',
              workspaces: { id: 'bid-1', name: 'Procurement' },
            },
          },
        },
        {
          id: 'brh-old',
          response_id: 'response-dup',
          edited_by: TEST_USER_ID,
          created_at: '2026-03-08T07:00:00Z',
          form_responses: {
            question_id: 'q-1',
            form_questions: {
              workspace_id: 'bid-1',
              question_text: 'Older answer',
              workspaces: { id: 'bid-1', name: 'Procurement' },
            },
          },
        },
        {
          id: 'brh-other',
          response_id: 'response-other',
          edited_by: TEST_USER_ID,
          created_at: '2026-03-08T08:00:00Z',
          form_responses: {
            question_id: 'q-2',
            form_questions: {
              workspace_id: 'bid-1',
              question_text: 'A different response',
              workspaces: { id: 'bid-1', name: 'Procurement' },
            },
          },
        },
      ],
    });

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true,
      'admin',
    );

    expect(result.reorient.my_recent_work).toHaveLength(2);
    expect(
      result.reorient.my_recent_work.map((item) => item.entity_id),
    ).toEqual(['response-dup', 'response-other']);
    expect(result.reorient.my_recent_work[0].entity_title).toBe(
      'Latest answer',
    );
  });

  it('error array tracks RPC failure', async () => {
    const mock = setupDefaultMock();

    // Make the attention counts RPC fail. ID-131 {131.19}: the
    // get_grouped_activity_feed RPC was removed entirely — recent_activity
    // is now Promise.resolve({data: [], error: null}), so it can never fail
    // or push a 'recent_activity query failed' error.
    mock.rpc.mockImplementation(() =>
      Promise.resolve({
        data: null,
        error: { message: 'attention counts fail' },
      }),
    );

    const result = await fetchUnifiedDashboardData(
      mock as never,
      TEST_USER_ID,
      true, // isAdmin
      'admin',
    );

    expect(result.errors).toContain('attention_counts RPC failed');
    expect(result.errors).not.toContain('recent_activity query failed');
    expect(result.recent_activity).toEqual([]);
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

  it('reorient bid_summary is populated from active procurements data', async () => {
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
          domain_metadata: {
            deadline: '2026-03-20T00:00:00Z',
            buyer: 'BigCo',
            status: 'in_progress',
          },
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
    expect(bid.href).toBe('/procurement/bid-x');
  });

  it('returns empty arrays when no data exists', async () => {
    const mock = setupDefaultMock({
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
    // ID-131.19 S450 Wave 1 Fix 4: re-seeded via bidResponseRecentWorkData —
    // the content_history leg that used to supply this data is retired, but
    // the 5-item cap logic (dedupeRecentWorkByEntity(...).slice(0, 5)) still
    // applies to whatever the surviving source produces.
    const mock = setupDefaultMock({
      bidResponseRecentWorkData: Array.from({ length: 8 }, (_, i) => ({
        id: `brh-${i}`,
        response_id: `response-${i}`,
        edited_by: TEST_USER_ID,
        created_at: new Date(Date.now() - i * 3600000).toISOString(),
        form_responses: {
          question_id: `q-${i}`,
          form_questions: {
            workspace_id: 'bid-1',
            question_text: `Question ${i}`,
            workspaces: { id: 'bid-1', name: 'Procurement' },
          },
        },
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
