/**
 * Tests for the quality-score cron route.
 *
 * Verifies:
 *   - Cron auth verification
 *   - Batch processing of content items
 *   - Score calculation and storage
 *   - previous_quality_score preservation
 *   - Threshold-based notification creation (transition only)
 *   - Per-domain threshold from governance_config
 *   - Pipeline run logging
 *   - Governance bridge: auto-flag items, draft exclusion, cooldown, batch summary
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

const { mockCreateBulkNotifications } = vi.hoisted(() => ({
  mockCreateBulkNotifications: vi.fn(),
}));

vi.mock('@/lib/notifications', () => ({
  createBulkNotifications: mockCreateBulkNotifications,
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

function makeContentItem(overrides: Partial<{
  id: string;
  title: string;
  primary_domain: string | null;
  freshness: string | null;
  classification_confidence: number | null;
  brief: string | null;
  detail: string | null;
  reference: string | null;
  ai_summary: string | null;
  metadata: Record<string, unknown> | null;
  quality_score: number | null;
  governance_review_status: string | null;
  verified_at: string | null;
}> = {}) {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-000000000010',
    title: overrides.title ?? 'Test Item',
    primary_domain: overrides.primary_domain ?? 'Operations',
    freshness: overrides.freshness ?? 'fresh',
    classification_confidence: overrides.classification_confidence ?? 0.9,
    brief: overrides.brief ?? 'A brief summary',
    detail: overrides.detail ?? null,
    reference: overrides.reference ?? null,
    ai_summary: overrides.ai_summary ?? 'An AI summary',
    metadata: overrides.metadata ?? null,
    quality_score: overrides.quality_score ?? null,
    governance_review_status: overrides.governance_review_status ?? null,
    verified_at: overrides.verified_at ?? null,
  };
}

function createCronRequest() {
  return new Request('http://localhost:3000/api/cron/quality-score', {
    method: 'GET',
    headers: { authorization: 'Bearer test-cron-secret' },
  });
}

/** Track which table .from() was called with, to return appropriate data */
let fromCallIndex = 0;
let fromResponses: Record<number, { table: string; data: unknown; error: unknown }> = {};

function resetMocks() {
  vi.clearAllMocks();
  fromCallIndex = 0;
  fromResponses = {};

  mockVerifyCronAuth.mockReturnValue(true);
  mockGetUsersByRole.mockResolvedValue([ADMIN_ID_1, ADMIN_ID_2]);
  mockCreateBulkNotifications.mockResolvedValue({ count: 0, error: null });

  // Configure chain defaults
  const chainableMethods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
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
 * The cron calls:
 *   1. from('governance_config').select(...)    -> govConfigs
 *   2. from('content_items').select(...)        -> batch of items
 *   3. from('content_items').update(...)        -> per-item updates (multiple)
 *   4. from('pipeline_runs').insert(...)        -> logging
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

    // content_items SELECT (paginated fetch)
    if (table === 'content_items') {
      // For the first content_items SELECT, return items
      // For subsequent SELECTs (empty page), return empty
      const selectChain = {
        select: vi.fn().mockReturnThis(),
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
            then: vi.fn((resolve: (v: unknown) => void) =>
              resolve({ data: null, error: null }),
            ),
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
  const updateCalls: Array<{ table: string; data: Record<string, unknown>; id?: string }> = [];
  const insertCalls: Array<{ table: string; data: Record<string, unknown> }> = [];
  let contentItemsCallCount = 0;

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

    if (table === 'content_items') {
      contentItemsCallCount++;
      return {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockImplementation(() => ({
          then: vi.fn((resolve: (v: unknown) => void) =>
            resolve({
              data: contentItemsCallCount === 1 ? items : [],
              error: null,
            }),
          ),
        })),
        update: vi.fn().mockImplementation((data: Record<string, unknown>) => {
          return {
            eq: vi.fn().mockImplementation((_col: string, id: string) => {
              updateCalls.push({ table, data, id });
              return {
                then: vi.fn((resolve: (v: unknown) => void) =>
                  resolve({ data: null, error: null }),
                ),
              };
            }),
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

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('processes items and calculates quality scores', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'fresh',
      classification_confidence: 0.9,
      brief: 'Brief content',
      ai_summary: 'Summary content',
      quality_score: null,
    });

    configureFromSequence({ items: [item] });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total_processed).toBe(1);
    expect(body.total_updated).toBe(1);
  });

  it('does not update items whose score has not changed', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'fresh',
      classification_confidence: 0.9,
      brief: 'Brief content',
      detail: null,
      reference: null,
      ai_summary: 'Summary content',
      quality_score: 70,
    });

    configureFromSequence({ items: [item] });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total_processed).toBe(1);
    expect(body.total_updated).toBe(0);
  });

  it('preserves previous_quality_score when updating', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      freshness: 'expired',
      classification_confidence: 0.5,
      brief: null,
      ai_summary: null,
      quality_score: 75,
    });

    const { updateCalls } = configureDetailedMock({ items: [item] });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    // Find the quality score update (not the governance update)
    const scoreUpdates = updateCalls.filter(u => u.data.quality_score !== undefined);
    expect(scoreUpdates.length).toBeGreaterThan(0);
    expect(scoreUpdates[0].data.previous_quality_score).toBe(75);
    expect(typeof scoreUpdates[0].data.quality_score).toBe('number');
    expect(scoreUpdates[0].data.quality_score).not.toBe(75);
  });

  it('creates quality_flag notifications when score drops below threshold', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Dropping Item',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      ai_summary: null,
      quality_score: 50,
    });

    configureDetailedMock({
      govConfigs: [{ domain: 'Operations', quality_score_threshold: 40 }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dropped_below_threshold).toBe(1);
    expect(body.notifications_created).toBeGreaterThan(0);

    expect(mockCreateBulkNotifications).toHaveBeenCalled();
    const notifications = mockCreateBulkNotifications.mock.calls[0][1] as Array<{
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

  it('does NOT notify for items already below threshold (no transition)', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.2,
      brief: null,
      ai_summary: null,
      quality_score: 10,
    });

    configureDetailedMock({
      govConfigs: [{ domain: 'Operations', quality_score_threshold: 40 }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dropped_below_threshold).toBe(0);
    expect(mockCreateBulkNotifications).not.toHaveBeenCalled();
  });

  it('uses per-domain threshold from governance_config', async () => {
    const complianceItem = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Compliance Item',
      primary_domain: 'Compliance',
      freshness: 'stale',
      classification_confidence: 0.7,
      brief: 'Brief',
      ai_summary: 'Summary',
      quality_score: 65,
    });

    const operationsItem = makeContentItem({
      id: '00000000-0000-4000-8000-000000000020',
      title: 'Operations Item',
      primary_domain: 'Operations',
      freshness: 'stale',
      classification_confidence: 0.7,
      brief: 'Brief',
      ai_summary: 'Summary',
      quality_score: 55,
    });

    configureDetailedMock({
      govConfigs: [
        { domain: 'Compliance', quality_score_threshold: 60 },
        { domain: 'Operations', quality_score_threshold: 30 },
      ],
      items: [complianceItem, operationsItem],
    });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dropped_below_threshold).toBe(1);

    expect(mockCreateBulkNotifications).toHaveBeenCalled();
    const notifications = mockCreateBulkNotifications.mock.calls[0][1] as Array<{
      entityId: string;
      title: string;
    }>;

    for (const notif of notifications) {
      expect(notif.entityId).toBe(complianceItem.id);
      expect(notif.title).toContain('Compliance Item');
    }
  });

  it('uses default threshold (40) when no governance_config exists for domain', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Unknown Domain',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      ai_summary: null,
      quality_score: 50,
    });

    configureDetailedMock({ items: [item] });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dropped_below_threshold).toBe(1);
  });

  it('logs results to pipeline_runs', async () => {
    const { insertCalls } = configureDetailedMock({ items: [makeContentItem()] });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const pipelineInserts = insertCalls.filter(c => c.table === 'pipeline_runs');
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

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total_processed).toBe(0);
    expect(body.total_updated).toBe(0);
  });

  it('handles null quality_score as first-time calculation (flags if below threshold)', async () => {
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'New Item',
      freshness: 'expired',
      classification_confidence: 0.2,
      brief: null,
      ai_summary: null,
      quality_score: null,
    });

    configureDetailedMock({ items: [item] });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total_updated).toBe(1);
    expect(body.dropped_below_threshold).toBe(1);

    expect(mockCreateBulkNotifications).toHaveBeenCalled();
    const notifications = mockCreateBulkNotifications.mock.calls[0][1] as Array<{
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
      ai_summary: null,
      quality_score: 50,
      governance_review_status: null,
    });

    const { updateCalls } = configureDetailedMock({
      govConfigs: [{
        domain: 'Operations',
        id: GOV_CONFIG_ID,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: true,
        auto_flag_cooldown_days: 7,
        reviewer_id: REVIEWER_ID,
        timeout_days: 14,
      }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(1);

    // Check that governance status was set to pending
    const govUpdates = updateCalls.filter(u => u.data.governance_review_status === 'pending');
    expect(govUpdates.length).toBe(1);
    expect(govUpdates[0].data.governance_reviewer_id).toBe(REVIEWER_ID);
    expect(govUpdates[0].data.governance_review_due).toBeDefined();
    // last_auto_flagged_at should NOT be set — cooldown uses verified_at instead
    expect(govUpdates[0].data.last_auto_flagged_at).toBeUndefined();

    // Check governance_review_needed notification was created (second call to createBulkNotifications)
    expect(mockCreateBulkNotifications).toHaveBeenCalledTimes(2);
    const govNotifications = mockCreateBulkNotifications.mock.calls[1][1] as Array<{
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
      ai_summary: null,
      quality_score: 50,
      governance_review_status: null,
    });

    configureDetailedMock({
      govConfigs: [{
        domain: 'Operations',
        id: GOV_CONFIG_ID,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: false,
        auto_flag_cooldown_days: 7,
      }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
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
      ai_summary: null,
      quality_score: 50,
      governance_review_status: 'draft',
    });

    configureDetailedMock({
      govConfigs: [{
        domain: 'Operations',
        id: GOV_CONFIG_ID,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: true,
        auto_flag_cooldown_days: 7,
      }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
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
      ai_summary: null,
      quality_score: 50,
      governance_review_status: 'pending',
    });

    configureDetailedMock({
      govConfigs: [{
        domain: 'Operations',
        id: GOV_CONFIG_ID,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: true,
        auto_flag_cooldown_days: 7,
      }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
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
      ai_summary: null,
      quality_score: 50,
      governance_review_status: 'changes_requested',
    });

    configureDetailedMock({
      govConfigs: [{
        domain: 'Operations',
        id: GOV_CONFIG_ID,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: true,
        auto_flag_cooldown_days: 7,
      }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
  });

  it('respects cooldown period and skips recently verified items', async () => {
    // Item was verified 3 days ago, cooldown is 7 days
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      ai_summary: null,
      quality_score: 50,
      governance_review_status: null,
      verified_at: threeDaysAgo,
    });

    configureDetailedMock({
      govConfigs: [{
        domain: 'Operations',
        id: GOV_CONFIG_ID,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: true,
        auto_flag_cooldown_days: 7,
      }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(0);
  });

  it('auto-flags items when cooldown has expired (verified_at outside cooldown)', async () => {
    // Item was verified 10 days ago, cooldown is 7 days -> should flag
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const item = makeContentItem({
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Expired Cooldown Item',
      primary_domain: 'Operations',
      freshness: 'expired',
      classification_confidence: 0.3,
      brief: null,
      ai_summary: null,
      quality_score: 50,
      governance_review_status: null,
      verified_at: tenDaysAgo,
    });

    configureDetailedMock({
      govConfigs: [{
        domain: 'Operations',
        id: GOV_CONFIG_ID,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: true,
        auto_flag_cooldown_days: 7,
      }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
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
      ai_summary: null,
      quality_score: 50,
      governance_review_status: null,
    });

    configureDetailedMock({
      govConfigs: [{
        domain: 'Operations',
        id: GOV_CONFIG_ID,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: true,
        auto_flag_cooldown_days: 7,
        reviewer_id: null,
        timeout_days: 7,
      }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(1);

    // Second createBulkNotifications call is governance
    expect(mockCreateBulkNotifications).toHaveBeenCalledTimes(2);
    const govNotifications = mockCreateBulkNotifications.mock.calls[1][1] as Array<{
      userId: string;
      type: string;
    }>;

    // Should notify both admins (no reviewer configured)
    expect(govNotifications.length).toBe(2);
    const userIds = govNotifications.map(n => n.userId).sort();
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
      ai_summary: null,
      quality_score: 50,
      governance_review_status: null,
    });

    const { insertCalls } = configureDetailedMock({
      govConfigs: [{
        domain: 'Operations',
        id: GOV_CONFIG_ID,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: true,
        auto_flag_cooldown_days: 7,
      }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const pipelineInserts = insertCalls.filter(c => c.table === 'pipeline_runs');
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
      ai_summary: null,
      quality_score: 50,
      governance_review_status: 'approved',
    });

    configureDetailedMock({
      govConfigs: [{
        domain: 'Operations',
        id: GOV_CONFIG_ID,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: true,
        auto_flag_cooldown_days: 7,
      }],
      items: [item],
    });

    const res = await GET(createCronRequest() as never);
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
        ai_summary: null,
        quality_score: 50,
        governance_review_status: null,
      }),
    );

    configureDetailedMock({
      govConfigs: [{
        domain: 'Operations',
        id: GOV_CONFIG_ID,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: true,
        auto_flag_cooldown_days: 7,
        reviewer_id: REVIEWER_ID,
        timeout_days: 14,
      }],
      items,
    });

    const res = await GET(createCronRequest() as never);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.auto_governance_triggered).toBe(25);
    expect(body.batch_summary_notification).toBe(true);

    // Governance notifications should use batch summary path
    // First call = quality_flag notifications (individual per admin)
    // Second call = governance summary (one per unique recipient)
    expect(mockCreateBulkNotifications).toHaveBeenCalledTimes(2);

    const govNotifications = mockCreateBulkNotifications.mock.calls[1][1] as Array<{
      userId: string;
      type: string;
      entityType: string;
      entityId: string;
      title: string;
      message: string;
    }>;

    // Should have one notification per unique recipient (reviewer + 2 admins = 3)
    const recipientIds = new Set(govNotifications.map(n => n.userId));
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
