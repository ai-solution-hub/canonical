/**
 * useNotifications Hook Tests (TanStack Query migration)
 *
 * Tests the useNotifications hook — fetch on mount via useQuery,
 * refetchInterval polling, useMutation for mark-as-read with optimistic
 * updates, server-provided unread count, and custom event dispatch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
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
    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // fetchJson calls fetch(url) -- verify the notifications endpoint was called
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      fetchCalls.some((call: unknown[]) => call[0] === '/api/notifications'),
    ).toBe(true);
    expect(result.current.notifications).toHaveLength(3);
  });

  it('uses server-provided unreadCount instead of client-side counting', async () => {
    // Server says 5 unread even though only 2 in the list are unread --
    // this simulates more unread notifications beyond the 50-item cap
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockApiResponse(mockNotifications, 5)),
    });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should use the server-provided count (5), not client-computed (2)
    expect(result.current.unreadCount).toBe(5);
  });

  it('marks notifications as read via mutation', async () => {
    // After mark-as-read, the server returns updated notification state
    const updatedNotifications = mockNotifications.map((n) =>
      n.id === 'notif-1' ? { ...n, read_at: '2026-01-15T12:00:00Z' } : n,
    );

    (global.fetch as ReturnType<typeof vi.fn>)
      // 1st: initial fetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponse(mockNotifications, 2)),
      })
      // 2nd: mark-as-read mutation
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })
      // 3rd+: refetch after invalidation (returns updated state)
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse(updatedNotifications, 1)),
      });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markAsRead(['notif-1']);
    });

    // Verify the mutation called the correct endpoint
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const markReadCall = fetchCalls.find(
      (call: unknown[]) => call[0] === '/api/notifications/read',
    );
    expect(markReadCall).toBeDefined();
    const body = JSON.parse(markReadCall![1].body);
    expect(body.notification_ids).toEqual(['notif-1']);

    // Unread count should decrease (either via optimistic update or refetch)
    await waitFor(() => {
      expect(result.current.unreadCount).toBe(1);
    });
  });

  it('dispatches custom event after marking as read', async () => {
    const eventSpy = vi.fn();
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, eventSpy);

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponse(mockNotifications, 2)),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markAsRead(['notif-1']);
    });

    await waitFor(() => {
      expect(eventSpy).toHaveBeenCalledTimes(1);
    });

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
      })
      // Subsequent calls for refetch/invalidation after error
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse(mockNotifications, 2)),
      });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.markAsRead(['notif-1']);
    });

    // Wait for mutation to settle and verify no event
    await waitFor(() => {
      // After error + rollback, unreadCount should be back to original
      expect(result.current.unreadCount).toBe(2);
    });

    expect(eventSpy).not.toHaveBeenCalled();

    window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, eventSpy);
  });

  it('polls at the configured interval via refetchInterval', async () => {
    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Initial fetch (TanStack Query uses fetchJson which calls fetch with signal)
    const initialCallCount = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls.length;
    expect(initialCallCount).toBeGreaterThanOrEqual(1);

    // Advance by 5 minutes (poll interval)
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    // Should have polled again
    await waitFor(() => {
      expect(
        (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThan(initialCallCount);
    });
  });

  it('handles empty notification list', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockApiResponse([], 0)),
    });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unreadCount).toBe(0);
  });

  it('handles fetch failure gracefully', async () => {
    // fetchJson throws on non-ok, but the hook catches errors
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should not throw -- notifications fail silently via catch fallback
    expect(result.current.notifications).toHaveLength(0);
  });

  it('does not call API when markAsRead receives empty array', async () => {
    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const fetchCountBefore = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls.length;

    await act(async () => {
      await result.current.markAsRead([]);
    });

    // No additional fetch call (the guard returns early before calling mutate)
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      fetchCountBefore,
    );
  });

  it('optimistically updates notification read_at on markAsRead', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponse(mockNotifications, 2)),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Before marking as read, notif-1 has no read_at
    expect(
      result.current.notifications.find((n) => n.id === 'notif-1')?.read_at,
    ).toBeNull();

    await act(async () => {
      await result.current.markAsRead(['notif-1']);
    });

    // After optimistic update, notif-1 should have read_at set
    await waitFor(() => {
      const notif = result.current.notifications.find(
        (n) => n.id === 'notif-1',
      );
      expect(notif?.read_at).not.toBeNull();
    });
  });
});
