import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { GET as getConfig, POST as postConfig } from '@/app/api/governance/route';
import {
  GET as getReview,
  POST as postReview,
} from '@/app/api/governance/review/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '00000000-0000-4000-8000-000000000001';
const VALID_UUID_2 = '00000000-0000-4000-8000-000000000002';

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null, count: null });
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

  it('returns 200 with governance config list', async () => {
    // getAuthenticatedClient only checks auth, no role lookup
    const mockConfigs = [
      {
        id: VALID_UUID,
        domain: 'Cyber Security',
        posture: 'review_on_change',
        reviewer_id: VALID_UUID_2,
        timeout_days: 14,
        created_at: '2026-01-01T00:00:00Z',
        created_by: 'test-user-id',
        updated_at: '2026-01-01T00:00:00Z',
        updated_by: 'test-user-id',
      },
    ];

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: mockConfigs, error: null }),
    );

    const res = await getConfig();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].domain).toBe('Cyber Security');
    expect(json[0].posture).toBe('review_on_change');
  });

  it('returns 500 when Supabase query fails', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'DB error' } }),
    );

    const res = await getConfig();
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe('Failed to fetch governance configuration');
  });

  it('returns empty array when no config exists', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
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
      body: { domain: 'Test', posture: 'open' },
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
      body: { domain: 'Test', posture: 'open' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(403);
  });

  it('returns 403 for editor role (admin-only)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Test', posture: 'open' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 for missing domain', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { posture: 'open' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'domain' }),
      ]),
    );
  });

  it('returns 400 for invalid posture value', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Test Domain', posture: 'strict' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
    expect(json.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'posture' }),
      ]),
    );
  });

  it('creates new config when domain does not exist', async () => {
    configureRole(mockSupabase, 'admin');

    // First .single() call is consumed by configureRole (role lookup).
    // Second .single() call: domain lookup returns no existing entry.
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    // insert chain resolves
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'New Domain', posture: 'open', timeout_days: 14 },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe('created');

    expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'New Domain',
        posture: 'open',
        timeout_days: 14,
        created_by: 'test-user-id',
        updated_by: 'test-user-id',
      }),
    );
  });

  it('updates existing config when domain exists', async () => {
    configureRole(mockSupabase, 'admin');

    // Domain lookup returns existing entry
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID },
      error: null,
    });

    // update chain resolves
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Existing Domain', posture: 'review_on_change' },
    });
    const res = await postConfig(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe('updated');

    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        posture: 'review_on_change',
        updated_by: 'test-user-id',
      }),
    );
  });

  it('returns 500 when insert fails', async () => {
    configureRole(mockSupabase, 'admin');

    // Domain lookup returns no existing entry
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    // insert fails
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'Insert failed' } }),
    );

    const req = createTestRequest('/api/governance', {
      method: 'POST',
      body: { domain: 'Test', posture: 'open' },
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
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
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
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
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

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
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
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
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
      expect.arrayContaining([
        expect.objectContaining({ field: 'item_id' }),
      ]),
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
      expect.arrayContaining([
        expect.objectContaining({ field: 'action' }),
      ]),
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

    // Item lookup: pending
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, governance_review_status: 'pending' },
      error: null,
    });

    // Update chain resolves OK
    let _thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) => {
      _thenCallCount++;
      return resolve({ data: null, error: null });
    });

    // Notification lookup: different user updated the item
    mockSupabase._chain.single.mockResolvedValueOnce({
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
      data: { id: VALID_UUID, governance_review_status: 'pending' },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    // Notification lookup: same user — no notification
    mockSupabase._chain.single.mockResolvedValueOnce({
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
      data: { id: VALID_UUID, governance_review_status: 'pending' },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    mockSupabase._chain.single.mockResolvedValueOnce({
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

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, governance_review_status: 'pending' },
      error: null,
    });

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'Update failed' } }),
    );

    const req = createTestRequest('/api/governance/review', {
      method: 'POST',
      body: { item_id: VALID_UUID, action: 'approve' },
    });
    const res = await postReview(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to process governance review');
  });
});
