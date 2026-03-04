'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Hook for managing notifications with 5-minute polling.
 *
 * Returns unread notifications and methods to mark them as read.
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data: Notification[] = await res.json();
      setNotifications(data);
      setUnreadCount(data.filter((n) => !n.read_at).length);
    } catch {
      // Fail silently - notifications are non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  const markAsRead = useCallback(async (notificationIds: string[]) => {
    if (notificationIds.length === 0) return;

    try {
      const res = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_ids: notificationIds }),
      });

      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) =>
            notificationIds.includes(n.id)
              ? { ...n, read_at: new Date().toISOString() }
              : n,
          ),
        );
        setUnreadCount((prev) => Math.max(0, prev - notificationIds.length));
      }
    } catch {
      // Fail silently
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    const unreadIds = notifications
      .filter((n) => !n.read_at)
      .map((n) => n.id);
    await markAsRead(unreadIds);
  }, [notifications, markAsRead]);

  // Initial fetch + polling
  useEffect(() => {
    fetchNotifications();

    intervalRef.current = setInterval(fetchNotifications, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchNotifications]);

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    refresh: fetchNotifications,
  };
}
