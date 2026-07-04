/**
 * Tests for the quality-score cron route.
 *
 * ID-131 {131.19} G-GOV-FACET: content_items is dying — the cron now reads
 * the record_lifecycle facet (owner_kind='source_document') joined to
 * source_documents, instead of content_items. quality_score/
 * previous_quality_score/quality_score_updated_at have NO typed-record home
 * post-refactor (brief/detail/reference/citation_count/quality_score are all
 * dead columns — see the route's own header comment) — the score is now
 * computed fresh on every run for notification purposes only and is NEVER
 * persisted, so per-item persistence tests (previous_quality_score,
 * unchanged-score skip-write) no longer apply and have been removed/replaced
 * below. Because there is no persisted prior score, the "drops below
 * threshold" transition detection became a level-triggered "currently below
 * threshold" check, deduplicated per-day via `getExistingNotificationIds`
 * (same idempotency helper the sibling crons already use) rather than via a
 * stored previous value.
 *
 * Verifies:
 *   - Cron auth verification
 *   - Batch processing of source_documents (via the record_lifecycle facet join)
 *   - Score calculation (in-memory only, never persisted) + threshold notification
 *   - Same-day notification idempotency (replaces the old transition-only check)
 *   - Per-domain threshold from governance_config
 *   - Pipeline run logging
 *   - Governance bridge: auto-flag items, draft exclusion, cooldown, batch summary
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
import { GET } from '@/app/api/cron/quality-score/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_ID_1 = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID_2 = '00000000-0000-4000-8000-000000000002';
const REVIEWER_ID = '00000000-0000-4000-8000-000000000099';
const GOV_CONFIG_ID = '00000000-0000-4000-8000-000000000050';

/**
 * Builds a record_lifecycle-facet-joined-to-source_documents row, matching
 * the shape `app/api/cron/quality-score/route.ts` now reads (ID-131
 * {131.19}). Keeps the same override-parameter surface as the old
 * content_items-shaped factory so existing call sites don't need touching —
 * `brief`/`detail`/`reference`/`metadata`/`quality_score` are accepted but
 * IGNORED (dead columns, no typed-record home post-refactor; the route no
 * longer reads or persists any of them).
 */
function makeContentItem(
  overrides: Partial<{
    id: string;
    title: string;
    primary_domain: string | null;
    freshness: string | null;
    classification_confidence: number | null;
    brief: string | null;
    detail: string | null;
    reference: string | null;
    summary: string | null;
    metadata: Record<string, unknown> | null;
    quality_score: number | null;
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
    freshness: overrides.freshness ?? 'fresh',
    governance_review_status: overrides.governance_review_status ?? null,
    verified_at: overrides.verified_at ?? null,
    next_review_date: null,
    review_cadence_days: null,
    source_documents: {
      id,
      suggested_title: overrides.title ?? 'Test Item',
      filename: 'test-item.pdf',
      primary_domain: overrides.primary_domain ?? 'Operations',
      classification_confidence: overrides.classification_confidence ?? 0.9,
      summary: overrides.summary ?? 'An AI summary',
      archived_at: null,
    },
  };
}

/** Track which table .from() was called with, to return appropriate data */

function resetMocks() {
  vi.clearAllMocks();

  mockVerifyCronAuth.mockReturnValue(true);
  mockGetUsersByRole.mockResolvedValue([ADMIN_ID_1, ADMIN_ID_2]);
  mockCreateBulkNotifications.mockResolvedValue({ count: 0, error: null });
  // Default: nothing already notified today (no same-day dedup exclusions).
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
 * Configure sequential .from() calls to return different data.
 * ID-131 {131.19}: content_items is dying — the cron calls:
 *   1. from('governance_config').select(...)              -> govConfigs
 *   2. from('record_lifecycle').select(...).eq('owner_kind',...)
 *      .is('source_documents.archived_at', null).order(...).range(...)
 *                                                           -> batch of facet+SD rows
 *   3. from('record_lifecycle').update(...).eq('owner_kind',...)
 *      .eq('source_document_id',...)                       -> per-item governance updates
 *   4. from('pipeline_runs').insert(...)                   -> logging
 */
function configureFromSequence(options: {
  govConfigs?: Array<{
    domain: string;
    id?: string;
    quality_score_threshold: number | null;
    auto_flag_on_quality_drop?: boolean | null;
    auto_flag_cooldown_days?: number | null;
    reviewer_id?: string | null;
    timeout_days?: number | null;
  }>;
  items?: Array<ReturnType<typeof makeContentItem>>;
}) {
  const { govConfigs = [], items = [] } = options;
  let callCount = 0;

  mockSupabase.from.mockImplementation((table: string) => {
    callCount++;

    // governance_config SELECT (first call)
    if (table === 'governance_config' && callCount === 1) {
      const govChain = {
        select: vi.fn().mockReturnValue({
          then: vi.fn((resolve: (v: unknown) => void) =>
            resolve({ data: govConfigs, error: null }),
          ),
          data: govConfigs,
          error: null,
        }),
      };
      return govChain;
    }

    // record_lifecycle SELECT (paginated facet+source_documents fetch)
    if (table === 'record_lifecycle') {
      // For the first record_lifecycle SELECT, return items
      // For subsequent SELECTs (empty page), return empty
      const selectChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockImplementation((_start: number, _end: number) => {
          // On the first call, return items; on subsequent calls, return empty
          // Track if we've already returned items
          const isFirstBatch = items.length > 0 && !selectChain._returnedItems;
          selectChain._returnedItems = true;
          return {
            then: vi.fn((resolve: (v: unknown) => void) =>
              resolve({
                data: isFirstBatch ? items : [],
                error: null,
              }),
            ),
          };
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              then: vi.fn((resolve: (v: unknown) => void) =>
                resolve({ data: null, error: null }),
              ),
            }),
          }),
        }),
        _returnedItems: false,
      };
      return selectChain;
    }

    // pipeline_runs INSERT
    if (table === 'pipeline_runs') {
      return {
        insert: vi.fn().mockReturnValue({
          then: vi.fn((resolve: (v: unknown) => void) =>
            resolve({ data: null, error: null }),
          ),
        }),
      };
    }

    // Default fallback
    return mockSupabase._chain;
  });
}

/**
 * A more fine-grained mock that tracks update calls and
 * correctly handles both quality score and governance updates.
 */
function configureDetailedMock(options: {
  govConfigs?: Array<{
    domain: string;
    id?: string;
    quality_score_threshold: number | null;
    auto_flag_on_quality_drop?: boolean | null;
    auto_flag_cooldown_days?: number | null;
    reviewer_id?: string | null;
    timeout_days?: number | null;
  }>;
  items?: Array<ReturnType<typeof makeContentItem>>;
}) {
  const { govConfigs = [], items = [] } = options;
  const updateCalls: Array<{
    table: string;
    data: Record<string, unknown>;
    id?: string;
  }> = [];
  const insertCalls: Array<{ table: string; data: Record<string, unknown> }> =
    [];
  let recordLifecycleCallCount = 0;

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
    // joined to source_documents (owner_kind='source_document').
    if (table === 'record_lifecycle') {
      recordLifecycleCallCount++;
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockImplementation(() => ({
          then: vi.fn((resolve: (v: unknown) => void) =>
            resolve({
              data: recordLifecycleCallCount === 1 ? items : [],
              error: null,
            }),
          ),
        })),
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

    return mockSupabase._chain;
  });

  return { updateCalls, insertCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/quality-score', () => {
  beforeEach(resetMocks);

  it('returns 401 when cron auth fails', async () => {
    mockVerifyCronAuth.mockReturnValue(false);

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('processes items and calculates quality scores in-memory (never persisted)', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'fresh',
      classification_confidence: 0.9,
      summary: 'Summary content',
    });

    configureFromSequence({ items: [item] });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total_processed).toBe(1);
    // ID-131 {131.19}: quality_score has no typed-record home post-refactor
    // — the score is computed for notification purposes only and is NEVER
    // written back anywhere, so total_updated is always 0.
    expect(body.total_updated).toBe(0);
  });

  it('never issues a quality_score/previous_quality_score DB write (no typed-record home post-refactor)', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'expired',
      classification_confidence: 0.5,
      summary: null,
    });

    const { updateCalls } = configureDetailedMock({ items: [item] });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    // ID-131 {131.19}: content_items.quality_score/previous_quality_score/
    // quality_score_updated_at are dead columns — the cron must never write
    // any of them (the only permitted per-item update is the governance
    // bridge's governance_review_status/due/reviewer_id).
    const scoreUpdates = updateCalls.filter(
      (u) =>
        u.data.quality_score !== undefined ||
        u.data.previous_quality_score !== undefined,
    );
    expect(scoreUpdates.length).toBe(0);
  });

  it('creates quality_flag notifications when score drops below threshold', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Dropping Item',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
    });

    configureDetailedMock({
      govConfigs: [{ domain: 'Operations', quality_score_threshold: 40 }],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dropped_below_threshold).toBe(1);
    expect(body.notifications_created).toBeGreaterThan(0);

    expect(mockCreateBulkNotifications).toHaveBeenCalled();
    const notifications = mockCreateBulkNotifications.mock
      .calls[0][1] as Array<{
      userId: string;
      type: string;
      entityId: string;
      title: string;
    }>;

    expect(notifications.length).toBe(2);
    for (const notif of notifications) {
      expect(notif.type).toBe('quality_flag');
      expect(notif.entityId).toBe(item.id);
      expect(notif.title).toContain('Dropping Item');
      expect([ADMIN_ID_1, ADMIN_ID_2]).toContain(notif.userId);
    }
  });

  it('skips the quality_flag notification for an item already notified today (same-day idempotency)', async () => {
    // ID-131 {131.19}: without a persisted prior score, the cron cannot
    // detect a "just crossed the threshold" transition — it is
    // level-triggered (every below-threshold item is a candidate on every
    // run) and instead relies on `getExistingNotificationIds` (today's
    // already-notified entity ids) to avoid duplicating a same-day
    // notification. This replaces the old edge-triggered "no transition"
    // test, which asserted behaviour that no longer exists.
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.2,
      summary: null,
    });

    mockGetExistingNotificationIds.mockResolvedValue(
      new Set([item.source_document_id]),
    );

    configureDetailedMock({
      // auto_flag_on_quality_drop: false isolates this test to the
      // quality_flag notification path — the governance bridge is a
      // separate mechanism with its own (verified_at cooldown-based, not
      // same-day-notification-based) eligibility check, exercised by the
      // "governance bridge" describe block below.
      govConfigs: [
        {
          domain: 'Operations',
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: false,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dropped_below_threshold).toBe(0);
    expect(mockCreateBulkNotifications).not.toHaveBeenCalled();
  });

  it('DOES notify again for a still-below-threshold item on a fresh day (level-triggered, not edge-triggered)', async () => {
    // ID-131 {131.19}: this is the documented behaviour change — the old
    // cron only notified on the run where the score first crossed the
    // threshold (using the persisted previous_quality_score); the new cron
    // has no persisted prior value, so it notifies on every run the item is
    // still below threshold (bounded only by same-day dedup, not tested
    // here since getExistingNotificationIds defaults to an empty set).
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.2,
      summary: null,
    });

    configureDetailedMock({
      govConfigs: [{ domain: 'Operations', quality_score_threshold: 40 }],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dropped_below_threshold).toBe(1);
    expect(mockCreateBulkNotifications).toHaveBeenCalled();
  });

  it('flags items only when their quality drops below their domain-specific threshold', async () => {
    const complianceItem = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Compliance Item',
      primary_domain: 'Compliance',
      freshness: 'stale',
      classification_confidence: 0.7,
      brief: 'Brief',
      summary: 'Summary',
      quality_score: 65,
    });

    const operationsItem = makeContentItem({
      id: '00000000-0000-4000-8000-000000000020',
      title: 'Operations Item',
      primary_domain: 'Operations',
      freshness: 'stale',
      classification_confidence: 0.7,
      brief: 'Brief',
      summary: 'Summary',
      quality_score: 55,
    });

    configureDetailedMock({
      govConfigs: [
        { domain: 'Compliance', quality_score_threshold: 60 },
        { domain: 'Operations', quality_score_threshold: 30 },
      ],
      items: [complianceItem, operationsItem],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dropped_below_threshold).toBe(1);

    expect(mockCreateBulkNotifications).toHaveBeenCalled();
    const notifications = mockCreateBulkNotifications.mock
      .calls[0][1] as Array<{
      entityId: string;
      title: string;
    }>;

    for (const notif of notifications) {
      expect(notif.entityId).toBe(complianceItem.id);
      expect(notif.title).toContain('Compliance Item');
    }
  });

  it('falls back to a default 40 quality threshold when the domain has no governance_config row', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Unknown Domain',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
    });

    configureDetailedMock({ items: [item] });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dropped_below_threshold).toBe(1);
  });

  it('logs results to pipeline_runs', async () => {
    const { insertCalls } = configureDetailedMock({
      items: [makeContentItem()],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const pipelineInserts = insertCalls.filter(
      (c) => c.table === 'pipeline_runs',
    );
    expect(pipelineInserts.length).toBe(1);
    expect(pipelineInserts[0].data.pipeline_name).toBe('quality_score');
    expect(pipelineInserts[0].data.status).toBe('completed');
    expect(pipelineInserts[0].data.items_processed).toBe(1);

    const result = pipelineInserts[0].data.result as Record<string, unknown>;
    expect(result.total_processed).toBe(1);
    expect(typeof result.duration_ms).toBe('number');
  });

  it('handles empty content items gracefully', async () => {
    configureFromSequence({ items: [] });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total_processed).toBe(0);
    expect(body.total_updated).toBe(0);
  });

  it('flags a below-threshold item (every run is effectively first-time — no persisted score exists)', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'New Item',
      freshness: 'expired',
      classification_confidence: 0.2,
      summary: null,
    });

    configureDetailedMock({ items: [item] });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    // ID-131 {131.19}: quality_score is never persisted, so total_updated
    // (a persisted-write counter) is always 0.
    expect(body.total_updated).toBe(0);
    expect(body.dropped_below_threshold).toBe(1);

    expect(mockCreateBulkNotifications).toHaveBeenCalled();
    const notifications = mockCreateBulkNotifications.mock
      .calls[0][1] as Array<{
      userId: string;
      type: string;
      entityId: string;
      title: string;
    }>;
    expect(notifications.length).toBe(2);
    for (const notif of notifications) {
      expect(notif.type).toBe('quality_flag');
      expect(notif.entityId).toBe(item.id);
      expect(notif.title).toContain('New Item');
      expect([ADMIN_ID_1, ADMIN_ID_2]).toContain(notif.userId);
    }
  });
});

// ===========================================================================
// Governance bridge tests
// ===========================================================================

describe('GET /api/cron/quality-score — governance bridge', () => {
  beforeEach(resetMocks);

  it('auto-flags items for governance review when auto_flag_on_quality_drop is enabled', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Auto-Flag Item',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
      governance_review_status: null,
    });

    const { updateCalls } = configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: true,
          auto_flag_cooldown_days: 7,
          reviewer_id: REVIEWER_ID,
          timeout_days: 14,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
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
    // last_auto_flagged_at should NOT be set — cooldown uses verified_at instead
    expect(govUpdates[0].data.last_auto_flagged_at).toBeUndefined();

    // Check governance_review_needed notification was created (second call to createBulkNotifications)
    expect(mockCreateBulkNotifications).toHaveBeenCalledTimes(2);
    const govNotifications = mockCreateBulkNotifications.mock
      .calls[1][1] as Array<{
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

  it('does NOT auto-flag when auto_flag_on_quality_drop is disabled', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
      governance_review_status: null,
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: false,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
    expect(body.dropped_below_threshold).toBe(1);
  });

  it('excludes items with governance_review_status = draft from auto-flagging', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
      governance_review_status: 'draft',
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
  });

  it('excludes items already in pending governance review', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
      governance_review_status: 'pending',
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
  });

  it('excludes items in changes_requested governance state', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
      governance_review_status: 'changes_requested',
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
  });

  it('respects cooldown period and skips recently verified items', async () => {
    // Item was verified 3 days ago, cooldown is 7 days
    const threeDaysAgo = new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
      governance_review_status: null,
      verified_at: threeDaysAgo,
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
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
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Expired Cooldown Item',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
      governance_review_status: null,
      verified_at: tenDaysAgo,
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(1);
  });

  it('sends governance notification to admins when no reviewer configured', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'No Reviewer Item',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
      governance_review_status: null,
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: true,
          auto_flag_cooldown_days: 7,
          reviewer_id: null,
          timeout_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(1);

    // Second createBulkNotifications call is governance
    expect(mockCreateBulkNotifications).toHaveBeenCalledTimes(2);
    const govNotifications = mockCreateBulkNotifications.mock
      .calls[1][1] as Array<{
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

  it('logs auto_governance_triggered count in pipeline_runs', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
      governance_review_status: null,
    });

    const { insertCalls } = configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
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

  it('allows auto-flag for items with governance_review_status = approved', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      summary: null,
      quality_score: 50,
      governance_review_status: 'approved',
    });

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: true,
          auto_flag_cooldown_days: 7,
        },
      ],
      items: [item],
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(1);
  });

  it('creates summary notification per reviewer when >20 items are flagged', async () => {
    // Generate 25 items that will all drop below threshold
    const items = Array.from({ length: 25 }, (_, i) =>
      makeContentItem({
        id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`,
        title: `Batch Item ${i + 1}`,
        primary_domain: 'Operations',
        freshness: 'expired',
        classification_confidence: 0.2,
        brief: null,
        summary: null,
        quality_score: 50,
        governance_review_status: null,
      }),
    );

    configureDetailedMock({
      govConfigs: [
        {
          domain: 'Operations',
          id: GOV_CONFIG_ID,
          quality_score_threshold: 40,
          auto_flag_on_quality_drop: true,
          auto_flag_cooldown_days: 7,
          reviewer_id: REVIEWER_ID,
          timeout_days: 14,
        },
      ],
      items,
    });

    const res = await GET(
      createMockCronRequest({ path: '/api/cron/quality-score' }) as never,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(25);
    expect(body.batch_summary_notification).toBe(true);

    // Governance notifications should use batch summary path
    // First call = quality_flag notifications (individual per admin)
    // Second call = governance summary (one per unique recipient)
    expect(mockCreateBulkNotifications).toHaveBeenCalledTimes(2);

    const govNotifications = mockCreateBulkNotifications.mock
      .calls[1][1] as Array<{
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
    expect(govNotifications.length).toBe(3);

    // All should be summary-style governance_review_needed
    for (const notif of govNotifications) {
      expect(notif.type).toBe('governance_review_needed');
      expect(notif.entityType).toBe('domain');
      expect(notif.title).toContain('25 items flagged');
    }
  });
});
