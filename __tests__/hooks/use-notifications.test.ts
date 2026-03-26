/**
 * WP7: useNotifications Hook Tests
 *
 * Tests the useNotifications hook — fetch on mount, polling interval,
 * markAsRead API call, server-provided unread count, and event dispatch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useNotifications,
  NOTIFICATIONS_UPDATED_EVENT,
  type Notification,
} from '@/hooks/use-notifications';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockNotifications: Notification[] = [
  {
    id: 'notif-1',
    user_id: 'user-1',
    type: 'governance_review_needed',
    entity_type: 'content_item',
    entity_id: 'item-1',
    title: 'Review required',
    message: 'Item was updated',
    read_at: null,
    dismissed_at: null,
    expires_at: null,
    created_at: '2026-01-15T10:00:00Z',
  },
  {
    id: 'notif-2',
    user_id: 'user-1',
    type: 'freshness_alert',
    entity_type: 'content_item',
    entity_id: 'item-2',
    title: 'Content may be stale',
    message: null,
    read_at: '2026-01-14T08:00:00Z',
    dismissed_at: null,
    expires_at: null,
    created_at: '2026-01-14T08:00:00Z',
  },
  {
    id: 'notif-3',
    user_id: 'user-1',
    type: 'quality_flag',
    entity_type: 'content_item',
    entity_id: 'item-3',
    title: 'Quality issue detected',
    message: 'Low confidence classification',
    read_at: null,
    dismissed_at: null,
    expires_at: null,
    created_at: '2026-01-13T12:00:00Z',
  },
];

/** Helper to build the API response shape expected by the hook */
function mockApiResponse(notifications: Notification[], unreadCount: number) {
  return { notifications, unreadCount };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockApiResponse(mockNotifications, 2)),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches notifications on mount', async () => {
    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/notifications');
    expect(result.current.notifications).toHaveLength(3);
  });

  it('uses server-provided unreadCount instead of client-side counting', async () => {
    // Server says 5 unread even though only 2 in the list are unread —
    // this simulates more unread notifications beyond the 50-item cap
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockApiResponse(mockNotifications, 5)),
    });

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should use the server-provided count (5), not client-computed (2)
    expect(result.current.unreadCount).toBe(5);
  });

  it('marks notifications as read via API call', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponse(mockNotifications, 2)),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markAsRead(['notif-1']);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/notifications/read',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ notification_ids: ['notif-1'] }),
      }),
    );

    // Unread count should decrease
    expect(result.current.unreadCount).toBe(1);
  });

  it('dispatches custom event after marking as read', async () => {
    const eventSpy = vi.fn();
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, eventSpy);

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponse(mockNotifications, 2)),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markAsRead(['notif-1']);
    });

    expect(eventSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, eventSpy);
  });

  it('does not dispatch event when markAsRead API fails', async () => {
    const eventSpy = vi.fn();
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, eventSpy);

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponse(mockNotifications, 2)),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed' }),
      });

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markAsRead(['notif-1']);
    });

    expect(eventSpy).not.toHaveBeenCalled();

    window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, eventSpy);
  });

  it('polls at the configured interval', async () => {
    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Initial fetch
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Advance by 5 minutes (poll interval)
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    // Should have polled again
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('handles empty notification list', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockApiResponse([], 0)),
    });

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unreadCount).toBe(0);
  });

  it('handles fetch failure gracefully', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should not throw — notifications fail silently
    expect(result.current.notifications).toHaveLength(0);
  });

  it('does not call API when markAsRead receives empty array', async () => {
    const { result } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const fetchCountBefore = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    await act(async () => {
      await result.current.markAsRead([]);
    });

    // No additional fetch call
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCountBefore);
  });
});
