import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
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

// Suppress console.error noise from the route's error handling
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handlers under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import { GET as getNotifications } from '@/app/api/notifications/route';
import { POST as markRead } from '@/app/api/notifications/read/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID_1 = '00000000-0000-4000-8000-000000000001';
const VALID_UUID_2 = '00000000-0000-4000-8000-000000000002';

/** Reset mock state and restore default authenticated user. */
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

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------

describe('GET /api/notifications', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await getNotifications();

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 200 with notification list on success', async () => {
    const mockNotifications = [
      {
        id: VALID_UUID_1,
        title: 'Content needs review',
        message: 'Item X is aging',
        type: 'freshness',
        entity_type: 'content_item',
        entity_id: VALID_UUID_2,
        user_id: 'test-user-id',
        read_at: null,
        dismissed_at: null,
        expires_at: null,
        created_at: '2026-03-01T10:00:00Z',
      },
      {
        id: VALID_UUID_2,
        title: 'New item flagged',
        message: 'Item Y was flagged',
        type: 'quality',
        entity_type: 'content_item',
        entity_id: VALID_UUID_1,
        user_id: 'test-user-id',
        read_at: null,
        dismissed_at: null,
        expires_at: null,
        created_at: '2026-03-01T09:00:00Z',
      },
    ];

    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: mockNotifications, error: null }),
    );

    const res = await getNotifications();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(2);
    expect(json[0].id).toBe(VALID_UUID_1);
    expect(json[1].id).toBe(VALID_UUID_2);
  });

  it('returns notifications scoped to the current user', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    await getNotifications();

    expect(mockSupabase.from).toHaveBeenCalledWith('notifications');
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
    expect(mockSupabase._chain.is).toHaveBeenCalledWith('dismissed_at', null);
    expect(mockSupabase._chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mockSupabase._chain.limit).toHaveBeenCalledWith(50);
  });

  it('returns empty array when user has no notifications', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const res = await getNotifications();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it('returns empty array when data is null', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const res = await getNotifications();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it('returns 500 on database error', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'Database connection failed' } }),
    );

    const res = await getNotifications();

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch notifications');
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/read
// ---------------------------------------------------------------------------

describe('POST /api/notifications/read', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/notifications/read', {
      method: 'POST',
      body: { notification_ids: [VALID_UUID_1] },
    });

    const res = await markRead(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 200 on successful mark-as-read', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    );

    const req = createTestRequest('/api/notifications/read', {
      method: 'POST',
      body: { notification_ids: [VALID_UUID_1, VALID_UUID_2] },
    });

    const res = await markRead(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.count).toBe(2);

    // Verify update was scoped to the current user
    expect(mockSupabase.from).toHaveBeenCalledWith('notifications');
    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ read_at: expect.any(String) }),
    );
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
    expect(mockSupabase._chain.in).toHaveBeenCalledWith('id', [VALID_UUID_1, VALID_UUID_2]);
    expect(mockSupabase._chain.is).toHaveBeenCalledWith('read_at', null);
  });

  it('returns 400 when notification_ids is missing', async () => {
    const req = createTestRequest('/api/notifications/read', {
      method: 'POST',
      body: {},
    });

    const res = await markRead(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 400 when notification_ids is empty', async () => {
    const req = createTestRequest('/api/notifications/read', {
      method: 'POST',
      body: { notification_ids: [] },
    });

    const res = await markRead(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 400 when notification_ids contains non-UUID values', async () => {
    const req = createTestRequest('/api/notifications/read', {
      method: 'POST',
      body: { notification_ids: ['not-a-uuid'] },
    });

    const res = await markRead(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 500 on database error during mark-as-read', async () => {
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'Update failed' } }),
    );

    const req = createTestRequest('/api/notifications/read', {
      method: 'POST',
      body: { notification_ids: [VALID_UUID_1] },
    });

    const res = await markRead(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to mark notifications as read');
  });
});
