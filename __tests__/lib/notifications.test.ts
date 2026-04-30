import { describe, it, expect, vi, beforeEach } from 'vitest';

// WP2 (S19): lib/notifications.ts now routes failure logs through
// @/lib/logger (logger.error) instead of console.error.
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: loggerMocks,
  getRequestContext: () => undefined,
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T) => fn(),
  updateRequestContext: vi.fn(),
  withRequestContext: <T>(handler: T) => handler,
  withRequestContextBare: <T>(handler: T) => handler,
  applyRequestContextToSentry: vi.fn(),
}));

import {
  createNotification,
  createBulkNotifications,
  getExistingNotificationIds,
} from '@/lib/notifications';

beforeEach(() => {
  loggerMocks.error.mockClear();
  loggerMocks.warn.mockClear();
  loggerMocks.info.mockClear();
});

function createMockSupabase(
  insertResult: { error: { message: string } | null } = { error: null },
  selectResult: {
    data: Array<{ entity_id: string }> | null;
    error: { message: string } | null;
  } = { data: [], error: null },
) {
  return {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue(insertResult),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue(selectResult),
          }),
        }),
      }),
    }),
  };
}

describe('createNotification', () => {
  it('inserts a notification with 7-day default expiry', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({ insert: mockInsert }),
    };

    const { error } = await createNotification({
      supabase: mockSupabase as never,
      userId: 'user-1',
      type: 'freshness_transition',
      entityType: 'content_item',
      entityId: 'item-1',
      title: 'Test notification',
    });

    expect(error).toBeNull();
    expect(mockSupabase.from).toHaveBeenCalledWith('notifications');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        type: 'freshness_transition',
        entity_type: 'content_item',
        entity_id: 'item-1',
        title: 'Test notification',
        message: null,
      }),
    );

    // Verify expiry is ~7 days from now
    const insertedRow = mockInsert.mock.calls[0][0];
    const expiryDate = new Date(insertedRow.expires_at);
    const expectedExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiryDate.getTime() - expectedExpiry)).toBeLessThan(1000);
  });

  it('uses custom expiresAt when provided', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({ insert: mockInsert }),
    };

    const customExpiry = '2026-12-31T23:59:59.000Z';
    await createNotification({
      supabase: mockSupabase as never,
      userId: 'user-1',
      type: 'coverage_alert',
      entityType: 'domain',
      entityId: 'item-1',
      title: 'Test',
      expiresAt: customExpiry,
    });

    const insertedRow = mockInsert.mock.calls[0][0];
    expect(insertedRow.expires_at).toBe(customExpiry);
  });

  it('logs error on insert failure', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: vi
          .fn()
          .mockResolvedValue({ error: { message: 'insert failed' } }),
      }),
    };

    const { error } = await createNotification({
      supabase: mockSupabase as never,
      userId: 'user-1',
      type: 'freshness_transition',
      entityType: 'content_item',
      entityId: 'item-1',
      title: 'Test',
    });

    expect(error).toBeTruthy();
    // logger.error is invoked with the structured `{ err }` shape and the
    // notification type interpolated into the message.
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: { message: 'insert failed' } }),
      'Failed to create notification (freshness_transition)',
    );
  });
});

describe('createBulkNotifications', () => {
  it('returns count 0 for empty array', async () => {
    const mockSupabase = createMockSupabase();
    const result = await createBulkNotifications(mockSupabase as never, []);
    expect(result).toEqual({ count: 0, error: null });
  });

  it('inserts multiple notifications', async () => {
    const mockSelect = vi
      .fn()
      .mockResolvedValue({ data: [{ id: '1' }, { id: '2' }], error: null });
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({ insert: mockInsert }),
    };

    const notifications = [
      {
        userId: 'user-1',
        type: 'freshness_transition' as const,
        entityType: 'content_item',
        entityId: 'item-1',
        title: 'Notification 1',
      },
      {
        userId: 'user-2',
        type: 'freshness_transition' as const,
        entityType: 'content_item',
        entityId: 'item-2',
        title: 'Notification 2',
      },
    ];

    const result = await createBulkNotifications(
      mockSupabase as never,
      notifications,
    );
    expect(result.count).toBe(2);
    expect(result.error).toBeNull();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 'user-1', entity_id: 'item-1' }),
        expect.objectContaining({ user_id: 'user-2', entity_id: 'item-2' }),
      ]),
    );
  });
});

describe('getExistingNotificationIds', () => {
  it('returns empty set for empty input', async () => {
    const mockSupabase = createMockSupabase();
    const result = await getExistingNotificationIds(
      mockSupabase as never,
      'freshness_transition',
      [],
      new Date().toISOString(),
    );
    expect(result.size).toBe(0);
  });

  it('returns set of existing entity IDs', async () => {
    const mockSupabase = createMockSupabase(
      { error: null },
      { data: [{ entity_id: 'item-1' }, { entity_id: 'item-3' }], error: null },
    );

    const result = await getExistingNotificationIds(
      mockSupabase as never,
      'freshness_transition',
      ['item-1', 'item-2', 'item-3'],
      '2026-03-11T00:00:00.000Z',
    );

    expect(result.has('item-1')).toBe(true);
    expect(result.has('item-2')).toBe(false);
    expect(result.has('item-3')).toBe(true);
  });

  it('returns empty set on error', async () => {
    const mockSupabase = createMockSupabase(
      { error: null },
      { data: null, error: { message: 'query failed' } },
    );

    const result = await getExistingNotificationIds(
      mockSupabase as never,
      'freshness_transition',
      ['item-1'],
      '2026-03-11T00:00:00.000Z',
    );

    expect(result.size).toBe(0);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: { message: 'query failed' } }),
      'Failed to check existing notifications (freshness_transition)',
    );
  });
});
