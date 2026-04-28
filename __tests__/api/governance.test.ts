import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handlers under test (AFTER mocks)
// ---------------------------------------------------------------------------

import {
  GET as getConfig,
  POST as postConfig,
} from '@/app/api/governance/route';
import {
  GET as getReview,
  POST as postReview,
} from '@/app/api/governance/review/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

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

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ===========================================================================
// GET /api/governance
// ===========================================================================

describe('GET /api/governance', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await getConfig();
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 200 with governance config list including preset', async () => {
    const mockConfigs = [
      {
        id: VALID_UUID,
        domain: 'Cyber Security',
        posture: 'review_on_change',
        preset: 'strict',
        reviewer_id: null,
        timeout_days: 7,
        quality_score_threshold: 60,
        auto_flag_on_quality_drop: true,
        auto_flag_on_freshness_transition: true,
        auto_flag_cooldown_days: 14,
        created_at: '2026-01-01T00:00:00Z',
        created_by: 'test-user-id',
        updated_at: '2026-01-01T00:00:00Z',
        updated_by: 'test-user-id',
      },
    ];

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: mockConfigs, error: null }),
    );

    const res = await getConfig();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].domain).toBe('Cyber Security');
    expect(json[0].preset).toBe('strict');
    expect(json[0].posture).toBe('review_on_change');
  });

  it('returns 500 when Supabase query fails', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error' } }),
    );

    const res = await getConfig();
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe('Failed to fetch governance configuration');
  });

  it('returns empty array when no config exists', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const res = await getConfig();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual([]);
  });
});

// ===========================================================================
// POST /api/governance
// ===========================================================================

describe('POST /api/governance', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Test', preset: 'light_touch' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Test', preset: 'light_touch' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(403);
  });

  it('returns 403 for editor role (admin-only)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Test', preset: 'light_touch' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 for missing domain', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { preset: 'light_touch' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'domain' })]),
    );
  });

  it('returns 400 for invalid preset value', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Test Domain', preset: 'relaxed' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'preset' })]),
    );
  });

  it('returns 400 for old-format body (posture field only)', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Test Domain', posture: 'open' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'preset' })]),
    );
  });

  it('returns 400 for mixed old+new format body (preset AND posture)', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Test Domain', preset: 'strict', posture: 'open' },
    });
    const res = await postConfig(req);

    // Schema uses .strict() — unknown keys like posture are rejected.
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('creates config with light_touch preset values', async () => {
    configureRole(mockSupabase, 'admin');

    // Domain existence check uses .maybeSingle() — no row -> insert
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'New Domain', preset: 'light_touch' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe('created');

    expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'New Domain',
        preset: 'light_touch',
        posture: 'open',
        timeout_days: null,
        quality_score_threshold: 40,
        auto_flag_on_quality_drop: false,
        auto_flag_on_freshness_transition: false,
        auto_flag_cooldown_days: null,
        reviewer_id: null,
        created_by: 'test-user-id',
        updated_by: 'test-user-id',
      }),
    );
  });

  it('creates config with strict preset values', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Sensitive Domain', preset: 'strict' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe('created');

    expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'Sensitive Domain',
        preset: 'strict',
        posture: 'review_on_change',
        timeout_days: 7,
        quality_score_threshold: 60,
        auto_flag_on_quality_drop: true,
        auto_flag_on_freshness_transition: true,
        auto_flag_cooldown_days: 14,
        reviewer_id: null,
        created_by: 'test-user-id',
        updated_by: 'test-user-id',
      }),
    );
  });

  it('updates existing config when domain exists', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Existing Domain', preset: 'strict' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe('updated');

    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: 'strict',
        posture: 'review_on_change',
        timeout_days: 7,
        updated_by: 'test-user-id',
      }),
    );
  });

  it('returns 500 when insert fails', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'Insert failed' } }),
    );

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Test', preset: 'light_touch' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to create governance configuration');
  });
});

// ===========================================================================
// GET /api/governance/review
// ===========================================================================

describe('GET /api/governance/review', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/governance/review');
    const res = await getReview(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns count when count_only=true', async () => {
    // No role needed — just authenticated
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, count: 7 }),
    );

    const req = createTestRequest('/api/governance/review', {
      searchParams: { count_only: 'true' },
    });
    const res = await getReview(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(7);
  });

  it('returns count 0 on Supabase error when count_only=true', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error' }, count: null }),
    );

    const req = createTestRequest('/api/governance/review', {
      searchParams: { count_only: 'true' },
    });
    const res = await getReview(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(0);
  });

  it('returns 200 with pending items list', async () => {
    const mockItems = [
      {
        id: VALID_UUID,
        title: 'Stale Policy',
        suggested_title: null,
        primary_domain: 'Compliance',
        governance_review_status: 'pending',
        governance_review_due: '2026-03-01T00:00:00Z',
        governance_reviewer_id: null,
        updated_by: 'test-user-id',
        updated_at: '2026-02-15T00:00:00Z',
      },
    ];

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: mockItems, error: null }),
    );

    const req = createTestRequest('/api/governance/review');
    const res = await getReview(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].id).toBe(VALID_UUID);
    expect(json[0].governance_review_status).toBe('pending');
  });

  it('returns 500 when full list query fails', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error' } }),
    );

    const req = createTestRequest('/api/governance/review');
    const res = await getReview(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch governance reviews');
  });
});

// ===========================================================================
// POST /api/governance/review
// ===========================================================================

describe('POST /api/governance/review', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'approve' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'approve' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 for missing item_id', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { action: 'approve' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'item_id' })]),
    );
  });

  it('returns 400 for invalid action', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'delete' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'action' })]),
    );
  });

  it('returns 404 when item does not exist', async () => {
    configureRole(mockSupabase, 'editor');

    // Item lookup returns not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'approve' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Item not found');
  });

  it('returns 400 when item is not pending review', async () => {
    configureRole(mockSupabase, 'editor');

    // Item exists but is already approved
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, governance_review_status: 'approved' },
      error: null,
    });

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'approve' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Item is not pending governance review');
  });

  it('approves a pending item successfully', async () => {
    configureRole(mockSupabase, 'editor');

    // Item lookup: pending. §5.5 Phase 2 T2: fetch now includes
    // next_review_date + review_cadence_days. Item without cadence: renewal
    // is skipped (covered by the dedicated null-cadence test below).
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        governance_review_status: 'pending',
        next_review_date: null,
        review_cadence_days: null,
        verified_at: null,
      },
      error: null,
    });

    // Update return: .update().eq().select('id').single() succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    // Update chain resolves OK
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        return resolve({ data: null, error: null });
      },
    );

    // Notification itemDetail lookup now uses .maybeSingle()
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { updated_by: 'other-user-id' },
      error: null,
    });

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'approve' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe('approve');
    expect(json.item_id).toBe(VALID_UUID);

    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        governance_review_status: 'approved',
        governance_reviewer_id: 'test-user-id',
        governance_review_due: null,
      }),
    );
  });

  it('handles request_changes action', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        governance_review_status: 'pending',
        next_review_date: '2026-12-01',
        review_cadence_days: 180,
        verified_at: null,
      },
      error: null,
    });

    // Update return single
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    // Notification itemDetail lookup (now .maybeSingle()): same user — no notification
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { updated_by: 'test-user-id' },
      error: null,
    });

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: {
        item_id: VALID_UUID,
        action: 'request_changes',
        notes: 'Content needs updating',
      },
    });
    const res = await postReview(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe('request_changes');

    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        governance_review_status: 'changes_requested',
        governance_reviewer_id: 'test-user-id',
      }),
    );
  });

  it('handles revert action', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        governance_review_status: 'pending',
        next_review_date: '2026-12-01',
        review_cadence_days: 180,
        verified_at: null,
      },
      error: null,
    });

    // Update return single
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    // Notification itemDetail lookup now uses .maybeSingle()
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { updated_by: 'other-user-id' },
      error: null,
    });

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'revert' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe('revert');

    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        governance_review_status: 'reverted',
        governance_reviewer_id: 'test-user-id',
        governance_review_due: null,
      }),
    );
  });

  it('returns 500 when update fails', async () => {
    configureRole(mockSupabase, 'editor');

    // First .single() — fetch current item (succeeds)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        governance_review_status: 'pending',
        next_review_date: null,
        review_cadence_days: null,
        verified_at: null,
      },
      error: null,
    });

    // Second .single() — update with .select('id').single() (fails)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Update failed' },
    });

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'approve' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe(
      'Item not found or governance review update failed',
    );
  });

  // ──────────────────────────────────────────
  // S200 WP5 §5.5 Phase 1 / §6.5.1 — guard widening
  // ──────────────────────────────────────────

  it('approves an item already in review_overdue (Phase 2 cron path)', async () => {
    configureRole(mockSupabase, 'editor');

    // Item lookup: review_overdue (set by Phase 2 cron in real life).
    // §5.5 Phase 2 T2: cron-flipped items always have a configured cadence
    // (the cron only flips items where `next_review_date < CURRENT_DATE`,
    // which requires a populated cadence). The renewal assertion lives in
    // the dedicated T2 cadence test rows below.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        governance_review_status: 'review_overdue',
        next_review_date: null,
        review_cadence_days: null,
        verified_at: null,
      },
      error: null,
    });

    // Update return: .update().eq().select('id').single() succeeds
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    // Notification itemDetail lookup
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { updated_by: 'other-user-id' },
      error: null,
    });

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'approve' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe('approve');

    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        governance_review_status: 'approved',
        governance_reviewer_id: 'test-user-id',
        governance_review_due: null,
      }),
    );
  });

  it('continues to reject items in draft (regression check)', async () => {
    configureRole(mockSupabase, 'editor');

    // Item exists but is in draft — should still be rejected
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        governance_review_status: 'draft',
        next_review_date: null,
        review_cadence_days: null,
        verified_at: null,
      },
      error: null,
    });

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'approve' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Item is not pending governance review');
  });

  // ──────────────────────────────────────────
  // S201 §5.5 Phase 2 T2 — auto-renewal in approve handler
  // Plan: docs/plans/§5.5-phase-2-cron-plan.md T2
  // Spec: docs/specs/p0-document-control-lifecycle-spec.md §6.5 + §6.9 AC8
  //       (test rows 6 + 7 from §13.2 + 2 plan-additional rows)
  // ──────────────────────────────────────────

  describe('§5.5 Phase 2 T2 — auto-renewal on approve', () => {
    // Pinned-time pattern (CLAUDE.md gotcha): `setDate()` rounding can flip
    // around midnight UTC. We use `useFakeTimers` here (not the
    // `vi.spyOn(Date, 'now')` shorthand) because the cadence-renewal helper
    // takes its default "today" as `new Date()`, and Vitest fake timers
    // intercept the constructor as well as `Date.now`. Pin to 15/04/2026
    // 12:00 UTC.
    const PINNED_DATE = new Date('2026-04-15T12:00:00.000Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(PINNED_DATE);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('[spec row 6] approves overdue item with cadence + past next_review_date — advances to today + cadence', async () => {
      configureRole(mockSupabase, 'editor');

      // Overdue item: next_review_date in past (2025-12-01), cadence 180.
      // Today=2026-04-15. GREATEST(past, today)=today → today + 180d
      // = 2026-10-12.
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          governance_review_status: 'review_overdue',
          next_review_date: '2025-12-01',
          review_cadence_days: 180,
          verified_at: null,
        },
        error: null,
      });

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });

      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      );

      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { updated_by: 'other-user-id' },
        error: null,
      });

      const req = createTestRequest('/api/governance/review', {
        method: 'POST',
        body: { item_id: VALID_UUID, action: 'approve' },
      });
      const res = await postReview(req);

      expect(res.status).toBe(200);
      expect(mockSupabase._chain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          governance_review_status: 'approved',
          next_review_date: '2026-10-12',
        }),
      );
    });

    it('[spec row 7] approves item with future next_review_date — GREATEST picks the future date', async () => {
      configureRole(mockSupabase, 'editor');

      // Future next_review_date: 2027-12-31 + 180d = 2028-06-28.
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          governance_review_status: 'pending',
          next_review_date: '2027-12-31',
          review_cadence_days: 180,
          verified_at: null,
        },
        error: null,
      });

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });

      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      );

      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { updated_by: 'other-user-id' },
        error: null,
      });

      const req = createTestRequest('/api/governance/review', {
        method: 'POST',
        body: { item_id: VALID_UUID, action: 'approve' },
      });
      const res = await postReview(req);

      expect(res.status).toBe(200);
      expect(mockSupabase._chain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          governance_review_status: 'approved',
          next_review_date: '2028-06-28',
        }),
      );
    });

    it('[plan-additional] approves item with null cadence — does NOT touch next_review_date', async () => {
      configureRole(mockSupabase, 'editor');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          governance_review_status: 'pending',
          next_review_date: null,
          review_cadence_days: null,
          verified_at: null,
        },
        error: null,
      });

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });

      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      );

      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { updated_by: 'other-user-id' },
        error: null,
      });

      const req = createTestRequest('/api/governance/review', {
        method: 'POST',
        body: { item_id: VALID_UUID, action: 'approve' },
      });
      const res = await postReview(req);

      expect(res.status).toBe(200);
      const updateCall = mockSupabase._chain.update.mock.calls[0]?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(updateCall).toBeDefined();
      expect(updateCall).not.toHaveProperty('next_review_date');
    });

    it('[plan-additional] approves overdue item — UPDATE includes verified_at as a fresh ISO timestamp', async () => {
      configureRole(mockSupabase, 'editor');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          governance_review_status: 'review_overdue',
          next_review_date: '2025-12-01',
          review_cadence_days: 180,
          verified_at: null,
        },
        error: null,
      });

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });

      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      );

      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { updated_by: 'other-user-id' },
        error: null,
      });

      const req = createTestRequest('/api/governance/review', {
        method: 'POST',
        body: { item_id: VALID_UUID, action: 'approve' },
      });
      const res = await postReview(req);

      expect(res.status).toBe(200);
      const updateCall = mockSupabase._chain.update.mock.calls[0]?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(updateCall).toBeDefined();
      expect(updateCall).toHaveProperty('verified_at');
      expect(typeof updateCall?.verified_at).toBe('string');
      // ISO 8601 timestamp shape: YYYY-MM-DDTHH:MM:SS.sssZ
      expect(updateCall?.verified_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it('[untouched-other-branches] request_changes does NOT touch next_review_date', async () => {
      configureRole(mockSupabase, 'editor');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          governance_review_status: 'pending',
          next_review_date: '2026-12-01',
          review_cadence_days: 180,
          verified_at: null,
        },
        error: null,
      });

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });

      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      );

      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { updated_by: 'other-user-id' },
        error: null,
      });

      const req = createTestRequest('/api/governance/review', {
        method: 'POST',
        body: { item_id: VALID_UUID, action: 'request_changes' },
      });
      const res = await postReview(req);

      expect(res.status).toBe(200);
      const updateCall = mockSupabase._chain.update.mock.calls[0]?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(updateCall).toBeDefined();
      expect(updateCall).not.toHaveProperty('next_review_date');
      expect(updateCall).not.toHaveProperty('verified_at');
    });

    it('[untouched-other-branches] revert does NOT touch next_review_date', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          governance_review_status: 'pending',
          next_review_date: '2026-12-01',
          review_cadence_days: 180,
          verified_at: null,
        },
        error: null,
      });

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });

      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      );

      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { updated_by: 'other-user-id' },
        error: null,
      });

      const req = createTestRequest('/api/governance/review', {
        method: 'POST',
        body: { item_id: VALID_UUID, action: 'revert' },
      });
      const res = await postReview(req);

      expect(res.status).toBe(200);
      const updateCall = mockSupabase._chain.update.mock.calls[0]?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(updateCall).toBeDefined();
      expect(updateCall).not.toHaveProperty('next_review_date');
      expect(updateCall).not.toHaveProperty('verified_at');
    });
  });
});
