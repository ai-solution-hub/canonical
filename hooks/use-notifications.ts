'use client';

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  title: string;
  message: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  expires_at: string | null;
  created_at: string | null;
}

/** API response shape from GET /api/notifications */
interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Custom event dispatched when notifications are marked as read.
 * Other components (e.g. dashboard) can listen for this to refresh
 * stale server-rendered counts.
 */
export const NOTIFICATIONS_UPDATED_EVENT = 'notifications:updated';

/**
 * Hook for managing notifications with 5-minute polling.
 *
 * Returns unread notifications and methods to mark them as read.
 * The `unreadCount` is provided by the server (not computed client-side
 * from the capped list) so it remains accurate regardless of how many
 * notifications exist.
 *
 * Migrated from useState+useEffect to TanStack Query.
 */
export function useNotifications() {
  const queryClient = useQueryClient();

  const {
    data,
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.notifications.list,
    queryFn: () =>
      fetchJson<NotificationsResponse>('/api/notifications').catch(() => ({
        notifications: [] as Notification[],
        unreadCount: 0,
      })),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const markAsReadMutation = useMutation({
    mutationFn: (notificationIds: string[]) =>
      mutationFetchJson<Record<string, unknown>>(
        '/api/notifications/read',
        { notification_ids: notificationIds },
      ),
    onMutate: async (notificationIds: string[]) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications.list });

      // Snapshot the previous value for rollback
      const previous = queryClient.getQueryData<NotificationsResponse>(
        queryKeys.notifications.list,
      );

      // Optimistically update the cache
      queryClient.setQueryData<NotificationsResponse>(
        queryKeys.notifications.list,
        (old) => {
          if (!old) return old;
          return {
            notifications: old.notifications.map((n) =>
              notificationIds.includes(n.id)
                ? { ...n, read_at: new Date().toISOString() }
                : n,
            ),
            unreadCount: Math.max(0, old.unreadCount - notificationIds.length),
          };
        },
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      // Roll back to snapshot on error
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.notifications.list,
          context.previous,
        );
      }
    },
    onSuccess: () => {
      // Dispatch custom event so other components (e.g. dashboard QuickStatsStrip)
      // can refresh stale server-rendered values.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(NOTIFICATIONS_UPDATED_EVENT));
      }
    },
    onSettled: () => {
      // Refetch to ensure server state is in sync
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list });
    },
  });

  const { mutate: markAsReadMutate } = markAsReadMutation;

  const markAsRead = useCallback(
    async (notificationIds: string[]) => {
      if (notificationIds.length === 0) return;
      markAsReadMutate(notificationIds);
    },
    [markAsReadMutate],
  );

  const markAllAsRead = useCallback(async () => {
    const unreadIds = notifications
      .filter((n) => !n.read_at)
      .map((n) => n.id);
    if (unreadIds.length === 0) return;
    markAsReadMutate(unreadIds);
  }, [notifications, markAsReadMutate]);

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    refresh: refetch,
  };
}
