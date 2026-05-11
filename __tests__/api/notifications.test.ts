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

  it('returns 200 with notifications and unreadCount', async () => {
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

    // Both queries resolve via Promise.all — list then count
    let callCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          // List query
          return resolve({ data: mockNotifications, error: null });
        }
        // Count query
        return resolve({ data: null, error: null, count: 2 });
      },
    );

    const res = await getNotifications();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notifications).toHaveLength(2);
    expect(json.notifications[0].id).toBe(VALID_UUID_1);
    expect(json.notifications[1].id).toBe(VALID_UUID_2);
    expect(json.unreadCount).toBe(2);
  });

  it('returns accurate unreadCount independent of list limit', async () => {
    // Simulate: list returns 50 items (capped), but there are 73 unread in total
    const cappedList = Array.from({ length: 50 }, (_, i) => ({
      id: `uuid-${i}`,
      title: `Notification ${i}`,
      message: null,
      type: 'freshness',
      entity_type: 'content_item',
      entity_id: `item-${i}`,
      user_id: 'test-user-id',
      read_at: null,
      dismissed_at: null,
      expires_at: null,
      created_at: '2026-03-01T10:00:00Z',
    }));

    let callCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          return resolve({ data: cappedList, error: null });
        }
        // Server-side count returns the true total: 73
        return resolve({ data: null, error: null, count: 73 });
      },
    );

    const res = await getNotifications();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notifications).toHaveLength(50);
    expect(json.unreadCount).toBe(73);
  });

  it('orders notifications newest-first when multiple are returned', async () => {
    const newer = {
      id: VALID_UUID_1,
      title: 'Newer',
      message: null,
      type: 'freshness',
      entity_type: 'content_item',
      entity_id: VALID_UUID_2,
      user_id: 'test-user-id',
      read_at: null,
      dismissed_at: null,
      expires_at: null,
      created_at: '2026-03-02T10:00:00Z',
    };
    const older = {
      ...newer,
      id: VALID_UUID_2,
      title: 'Older',
      created_at: '2026-03-01T10:00:00Z',
    };

    let callCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          // Route is expected to return rows ordered newest-first.
          return resolve({ data: [newer, older], error: null });
        }
        return resolve({ data: null, error: null, count: 2 });
      },
    );

    const res = await getNotifications();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notifications.map((n: { title: string }) => n.title)).toEqual([
      'Newer',
      'Older',
    ]);
  });

  it('returns empty notifications with zero unreadCount when none exist', async () => {
    let callCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          return resolve({ data: [], error: null });
        }
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const res = await getNotifications();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notifications).toEqual([]);
    expect(json.unreadCount).toBe(0);
  });

  it('returns empty notifications when data is null', async () => {
    let callCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          return resolve({ data: null, error: null });
        }
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const res = await getNotifications();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notifications).toEqual([]);
    expect(json.unreadCount).toBe(0);
  });

  it('returns 500 on list query database error', async () => {
    let callCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          return resolve({
            data: null,
            error: { message: 'Database connection failed' },
          });
        }
        return resolve({ data: null, error: null, count: 0 });
      },
    );

    const res = await getNotifications();

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch notifications');
  });

  it('falls back to client-side count when count query fails', async () => {
    const mixedNotifications = [
      {
        id: VALID_UUID_1,
        title: 'Unread',
        message: null,
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
        title: 'Read',
        message: null,
        type: 'quality',
        entity_type: 'content_item',
        entity_id: VALID_UUID_1,
        user_id: 'test-user-id',
        read_at: '2026-03-01T11:00:00Z',
        dismissed_at: null,
        expires_at: null,
        created_at: '2026-03-01T09:00:00Z',
      },
    ];

    let callCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        callCount++;
        if (callCount === 1) {
          return resolve({ data: mixedNotifications, error: null });
        }
        // Count query fails
        return resolve({
          data: null,
          error: { message: 'Count failed' },
          count: null,
        });
      },
    );

    const res = await getNotifications();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notifications).toHaveLength(2);
    // Falls back to counting from the list (1 unread out of 2)
    expect(json.unreadCount).toBe(1);
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
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
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

    // Content-of-write is observable: the recorded update payload must
    // stamp a read_at timestamp on the affected rows.
    const updateArg = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateArg).toMatchObject({ read_at: expect.any(String) });
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
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
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
