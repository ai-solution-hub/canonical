/**
 * Tests for the review-cadence cron route.
 *
 * Spec rows §13.2:
 *   (a) overdue + null status                    -> flagged
 *   (b) overdue + superseded_by IS NOT NULL       -> not flagged
 *   (c) overdue + archived_at IS NOT NULL         -> not flagged
 *   (d) overdue + governance_review_status='pending' -> excluded by SQL filter
 *   (e) re-running on already-'review_overdue' items -> no-op
 *   (f) createBulkNotifications partial failure -> 'completed_with_errors'
 *
 * Spec/plan refs:
 *   docs/specs/p0-document-control-lifecycle-spec.md §6
 *   docs/plans/§5.5-phase-2-cron-plan.md T1
 *
 * The SQL filter chain `lt('next_review_date',...).is(...).is(...).or(...)`
 * runs server-side (PostgREST), so spec rows (b)/(c)/(d)/(e) are
 * exclusion-by-filter — the test asserts they appear as "0 candidates"
 * when the mock returns the post-filter result. The flagging branch (a)
 * + the failure branch (f) are the active code paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../../helpers/mock-supabase';

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

const { mockRecordPipelineRun } = vi.hoisted(() => ({
  mockRecordPipelineRun: vi.fn(),
}));

vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: mockRecordPipelineRun,
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
import { GET } from '@/app/api/cron/review-cadence/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_ID_1 = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID_2 = '00000000-0000-4000-8000-000000000002';
const OWNER_ID = '00000000-0000-4000-8000-000000000099';

interface ReviewCandidate {
  id: string;
  title: string;
  next_review_date: string | null;
  review_cadence_days: number | null;
  content_owner_id: string | null;
  governance_review_status: string | null;
  primary_domain: string | null;
}

function makeCandidate(
  overrides: Partial<ReviewCandidate> = {},
): ReviewCandidate {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-000000000010',
    title: overrides.title ?? 'Overdue Test Item',
    next_review_date: overrides.next_review_date ?? '2025-01-01',
    review_cadence_days: overrides.review_cadence_days ?? 180,
    content_owner_id: overrides.content_owner_id ?? null,
    governance_review_status: overrides.governance_review_status ?? null,
    primary_domain: overrides.primary_domain ?? 'Operations',
  };
}

function createCronRequest() {
  return new Request('http://localhost:3000/api/cron/review-cadence', {
    method: 'GET',
    headers: { authorization: 'Bearer test-cron-secret' },
  });
}

/**
 * Wire up the chainable mock so that:
 *   1. content_items SELECT (lt -> is -> is -> or) returns `candidates` post-filter.
 *      i.e. caller has already supplied items the SQL would have surfaced.
 *   2. content_items UPDATE (.update().eq()) records the call into updateCalls
 *      and resolves null/error per `updateError` map keyed on item id.
 *
 * Returns updateCalls so tests can assert per-item update payloads.
 */
function configureDetailedMock(options: {
  candidates: ReviewCandidate[];
  updateError?: Map<string, { message: string; code?: string }>;
}) {
  const { candidates, updateError } = options;
  const updateCalls: Array<{
    table: string;
    data: Record<string, unknown>;
    id: string;
  }> = [];

  // Hoisted so tests can assert filter-chain shape (per spec §6.3 exclusion table).
  // Without these spies the (b)/(c)/(d)/(e) exclusion tests would tautologically pass
  // even if the route's PostgREST filter chain were deleted.
  const selectChain = {
    lt: vi.fn().mockReturnThis() as unknown,
    is: vi.fn().mockReturnThis() as unknown,
    or: vi.fn().mockReturnThis() as unknown,
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: candidates, error: null }),
  };
  (selectChain.lt as ReturnType<typeof vi.fn>).mockReturnValue(selectChain);
  (selectChain.is as ReturnType<typeof vi.fn>).mockReturnValue(selectChain);
  (selectChain.or as ReturnType<typeof vi.fn>).mockReturnValue(selectChain);

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'content_items') {
      return {
        select: vi.fn().mockReturnValue(selectChain),
        update: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
          eq: vi.fn().mockImplementation((_col: string, id: string) => {
            updateCalls.push({ table, data, id });
            const err = updateError?.get(id);
            return {
              then: (resolve: (v: unknown) => unknown) =>
                resolve({ data: null, error: err ?? null }),
            };
          }),
        })),
      };
    }

    // pipeline_runs / notifications / others — unused (mocked at helper level)
    return mockSupabase._chain;
  });

  return { updateCalls, selectChain };
}

function resetMocks() {
  vi.clearAllMocks();

  mockVerifyCronAuth.mockReturnValue(true);
  mockGetUsersByRole.mockResolvedValue([ADMIN_ID_1, ADMIN_ID_2]);
  mockCreateBulkNotifications.mockResolvedValue({ count: 0, error: null });
  mockGetExistingNotificationIds.mockResolvedValue(new Set());
  mockRecordPipelineRun.mockResolvedValue(undefined);

  // Reset chain defaults
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
// Tests — auth + empty
// ---------------------------------------------------------------------------

describe('GET /api/cron/review-cadence — auth + empty', () => {
  beforeEach(resetMocks);

  it('returns 401 when cron auth fails', async () => {
    mockVerifyCronAuth.mockReturnValue(false);

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');

    // Pipeline run NOT recorded on auth failure — handler short-circuits
    expect(mockRecordPipelineRun).not.toHaveBeenCalled();
  });

  it('records 0-candidate run when no items are overdue', async () => {
    configureDetailedMock({ candidates: [] });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items_flagged).toBe(0);
    expect(body.notifications_created).toBe(0);
    expect(body.batch_summary_notification).toBe(false);
    expect(body.success).toBe(true);

    expect(mockRecordPipelineRun).toHaveBeenCalledOnce();
    const call = mockRecordPipelineRun.mock.calls[0][0];
    expect(call.pipelineName).toBe('review_cadence');
    expect(call.status).toBe('completed');
    expect(call.itemsProcessed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — spec §13.2 cron rows
// ---------------------------------------------------------------------------

describe('GET /api/cron/review-cadence — spec §13.2 cron rows', () => {
  beforeEach(resetMocks);

  it('(a) flags overdue items with null governance_review_status', async () => {
    const item = makeCandidate({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Null-Status Overdue',
      governance_review_status: null,
      content_owner_id: OWNER_ID,
    });

    const { updateCalls, selectChain } = configureDetailedMock({
      candidates: [item],
    });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items_flagged).toBe(1);

    // SQL filter-chain shape (spec §6.3 exclusion table) — without these
    // assertions, tests (b)/(c)/(d)/(e) would tautologically pass even if
    // the production route's PostgREST filter chain were deleted.
    expect(selectChain.lt).toHaveBeenCalledWith(
      'next_review_date',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(selectChain.is).toHaveBeenNthCalledWith(1, 'superseded_by', null);
    expect(selectChain.is).toHaveBeenNthCalledWith(2, 'archived_at', null);
    expect(selectChain.or).toHaveBeenCalledWith(
      'governance_review_status.is.null,governance_review_status.eq.approved',
    );

    // UPDATE call sets the right fields
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].data.governance_review_status).toBe('review_overdue');
    expect(updateCalls[0].data.governance_review_due).toBeDefined();
    expect(updateCalls[0].id).toBe(item.id);

    // Notification created with the spec §6.4 payload shape
    expect(mockCreateBulkNotifications).toHaveBeenCalledOnce();
    const notifications = mockCreateBulkNotifications.mock
      .calls[0][1] as Array<{
      userId: string;
      type: string;
      entityType: string;
      entityId: string;
      title: string;
      message: string;
    }>;
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      userId: OWNER_ID,
      type: 'review_overdue',
      entityType: 'content_item',
      entityId: item.id,
      title: `Review overdue: "${item.title}"`,
    });
    expect(notifications[0].message).toContain(item.title);
    expect(notifications[0].message).toContain(item.next_review_date!);

    // pipeline_runs row recorded with status=completed
    const runCall = mockRecordPipelineRun.mock.calls[0][0];
    expect(runCall.status).toBe('completed');
    expect(runCall.itemsProcessed).toBe(1);
  });

  it('(b) does NOT flag items with superseded_by (excluded by SQL filter)', async () => {
    // The route's SQL applies .is('superseded_by', null) — superseded items
    // never reach the candidates list. Mock returns [] to simulate filter.
    configureDetailedMock({ candidates: [] });

    const res = await GET(createCronRequest() as never);
    const body = await res.json();
    expect(body.items_flagged).toBe(0);
    expect(mockCreateBulkNotifications).not.toHaveBeenCalled();
  });

  it('(c) does NOT flag items with archived_at (excluded by SQL filter)', async () => {
    configureDetailedMock({ candidates: [] });

    const res = await GET(createCronRequest() as never);
    const body = await res.json();
    expect(body.items_flagged).toBe(0);
    expect(mockCreateBulkNotifications).not.toHaveBeenCalled();
  });

  it("(d) does NOT overwrite items with status='pending' (excluded by SQL filter)", async () => {
    // The .or('governance_review_status.is.null,governance_review_status.eq.approved')
    // filter excludes 'pending' / 'changes_requested' / 'draft' / 'reverted' /
    // 'review_overdue'. Mock returns [] for filter rejection.
    configureDetailedMock({ candidates: [] });

    const res = await GET(createCronRequest() as never);
    const body = await res.json();
    expect(body.items_flagged).toBe(0);
    expect(mockCreateBulkNotifications).not.toHaveBeenCalled();

    // No UPDATE was issued
    const runCall = mockRecordPipelineRun.mock.calls[0][0];
    expect(runCall.itemsProcessed).toBe(0);
  });

  it("(e) re-running on already-'review_overdue' items is a no-op", async () => {
    // The same SQL filter excludes 'review_overdue' status. Re-run = empty.
    configureDetailedMock({ candidates: [] });

    const res = await GET(createCronRequest() as never);
    const body = await res.json();
    expect(body.items_flagged).toBe(0);
    expect(body.notifications_created).toBe(0);
    expect(mockCreateBulkNotifications).not.toHaveBeenCalled();
  });

  it('(f) records completed_with_errors when createBulkNotifications fails', async () => {
    const item = makeCandidate({
      id: '00000000-0000-4000-8000-000000000020',
      title: 'Notif Failure Item',
      content_owner_id: OWNER_ID,
    });

    configureDetailedMock({ candidates: [item] });

    // Simulate notification dispatch failure
    mockCreateBulkNotifications.mockResolvedValueOnce({
      count: 0,
      error: { message: 'NOTIF_DB_DOWN', code: '500' } as unknown,
    });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Item was still flagged (UPDATE succeeded); notifications_created stays at 0
    expect(body.items_flagged).toBe(1);
    expect(body.notifications_created).toBe(0);
    expect(body.success).toBe(false);

    // pipeline_runs row records the partial failure
    expect(mockRecordPipelineRun).toHaveBeenCalledOnce();
    const runCall = mockRecordPipelineRun.mock.calls[0][0];
    expect(runCall.status).toBe('completed_with_errors');
    expect(runCall.errorMessage).toContain('createBulkNotifications');
    expect(runCall.errorMessage).toContain('NOTIF_DB_DOWN');
  });
});

// ---------------------------------------------------------------------------
// Tests — recipient resolution + batch summary
// ---------------------------------------------------------------------------

describe('GET /api/cron/review-cadence — recipient resolution', () => {
  beforeEach(resetMocks);

  it('falls back to admin broadcast when content_owner_id is null', async () => {
    const item = makeCandidate({
      id: '00000000-0000-4000-8000-000000000030',
      title: 'Unowned Overdue',
      content_owner_id: null,
    });

    configureDetailedMock({ candidates: [item] });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    expect(mockGetUsersByRole).toHaveBeenCalledWith(expect.anything(), [
      'admin',
    ]);

    const notifications = mockCreateBulkNotifications.mock
      .calls[0][1] as Array<{
      userId: string;
      type: string;
    }>;
    expect(notifications).toHaveLength(2); // ADMIN_ID_1 + ADMIN_ID_2
    const userIds = notifications.map((n) => n.userId).sort();
    expect(userIds).toEqual([ADMIN_ID_1, ADMIN_ID_2].sort());
  });

  it('uses batch summary path when >20 items are flagged', async () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      makeCandidate({
        id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`,
        title: `Batch Item ${i + 1}`,
        content_owner_id: OWNER_ID,
      }),
    );

    configureDetailedMock({ candidates: items });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items_flagged).toBe(25);
    expect(body.batch_summary_notification).toBe(true);

    // Single owner -> single summary notification
    const notifications = mockCreateBulkNotifications.mock
      .calls[0][1] as Array<{
      userId: string;
      title: string;
    }>;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe(OWNER_ID);
    expect(notifications[0].title).toContain('25 items overdue');
  });

  it('uses individual notifications at the 20-item threshold', async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeCandidate({
        id: `00000000-0000-4000-8000-${String(200 + i).padStart(12, '0')}`,
        title: `Item ${i + 1}`,
        content_owner_id: OWNER_ID,
      }),
    );

    configureDetailedMock({ candidates: items });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items_flagged).toBe(20);
    expect(body.batch_summary_notification).toBe(false);

    const notifications = mockCreateBulkNotifications.mock
      .calls[0][1] as Array<{
      title: string;
    }>;
    // 20 individual notifications, not a single summary
    expect(notifications).toHaveLength(20);
    for (const notif of notifications) {
      expect(notif.title).toContain('Review overdue:');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — notification idempotency
// ---------------------------------------------------------------------------

describe('GET /api/cron/review-cadence — notification idempotency', () => {
  beforeEach(resetMocks);

  it('skips notifications for items already notified today', async () => {
    const item = makeCandidate({
      id: '00000000-0000-4000-8000-000000000040',
      title: 'Already-Notified Item',
      content_owner_id: OWNER_ID,
    });

    configureDetailedMock({ candidates: [item] });

    // Simulate a notification already created today
    mockGetExistingNotificationIds.mockResolvedValueOnce(new Set([item.id]));

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items_flagged).toBe(1); // The flip itself still happened
    expect(body.notifications_created).toBe(0); // But no duplicate notification

    expect(mockCreateBulkNotifications).not.toHaveBeenCalled();
  });
});
