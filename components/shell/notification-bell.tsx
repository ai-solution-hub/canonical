'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BellOff,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle,
  Clock,
  FileCheck,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotifications, type Notification } from '@/hooks/use-notifications';
import { formatRelativeDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const NOTIFICATION_TYPE_ICONS: Record<string, LucideIcon> = {
  governance_review_needed: AlertCircle,
  governance_approve: CheckCircle,
  governance_request_changes: RefreshCw,
  governance_revert: XCircle,
  quality_flag: AlertTriangle,
  freshness_transition: Clock,
  owner_content_stale: Clock,
  owner_content_updated: FileCheck,
  date_expiry_approaching: CalendarClock,
  coverage_alert: BarChart3,
  content_gap: Search,
};

function NotificationIcon({ type }: { type: string }) {
  const Icon = NOTIFICATION_TYPE_ICONS[type] ?? Bell;
  return <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

function NotificationRow({
  notification,
  onClickNotification,
}: {
  notification: Notification;
  onClickNotification: (n: Notification) => void;
}) {
  const isUnread = !notification.read_at;

  return (
    <button
      type="button"
      onClick={() => onClickNotification(notification)}
      className={cn(
        'flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent last:border-0',
        isUnread ? 'bg-accent/50' : 'bg-transparent',
      )}
    >
      <NotificationIcon type={notification.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              'text-sm',
              isUnread ? 'font-medium' : 'text-muted-foreground',
            )}
          >
            {notification.title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
            {formatRelativeDate(notification.created_at)}
          </span>
        </div>
        {notification.message && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
            {notification.message}
          </p>
        )}
      </div>
    </button>
  );
}

interface NotificationBellProps {
  mobile?: boolean;
}

export function NotificationBell({ mobile }: NotificationBellProps) {
  const router = useRouter();
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const announcementRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  // Announce new notifications to screen readers via textContent update
  useEffect(() => {
    if (announcementRef.current && unreadCount > 0) {
      announcementRef.current.textContent =
        `${unreadCount} new notification${unreadCount === 1 ? '' : 's'}`;
    } else if (announcementRef.current) {
      announcementRef.current.textContent = '';
    }
  }, [unreadCount]);

  function handleClickNotification(notification: Notification) {
    markAsRead([notification.id]);
    setOpen(false);

    // Route source document notifications to the diff review page
    if (notification.entity_type === 'source_document') {
      router.push(`/documents/${notification.entity_id}/diff`);
    } else {
      router.push(`/item/${notification.entity_id}`);
    }
  }

  const badgeLabel =
    unreadCount === 0
      ? 'Notifications'
      : `Notifications (${unreadCount} unread)`;
  const badgeText = unreadCount > 9 ? '9+' : String(unreadCount);

  // Mobile variant: rendered as a nav-style link that opens the same popover
  if (mobile) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground dark:text-neutral-400 transition-colors hover:bg-accent"
            aria-label={badgeLabel}
          >
            <Bell className="size-4" />
            Notifications
            {unreadCount > 0 && (
              <span className="ml-auto inline-flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                {badgeText}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent id={`${popoverId}-mobile`} align="start" className="w-80 p-0">
          <NotificationPanel
            notifications={notifications}
            unreadCount={unreadCount}
            loading={loading}
            onMarkAllAsRead={markAllAsRead}
            onClickNotification={handleClickNotification}
          />
        </PopoverContent>
        {/* Screen reader announcement for new notifications */}
        <div ref={announcementRef} aria-live="polite" className="sr-only" />
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={badgeLabel}
          className="relative"
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {badgeText}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent id={`${popoverId}-desktop`} align="end" className="w-80 p-0">
        <NotificationPanel
          notifications={notifications}
          unreadCount={unreadCount}
          loading={loading}
          onMarkAllAsRead={markAllAsRead}
          onClickNotification={handleClickNotification}
        />
      </PopoverContent>
      {/* Screen reader announcement for new notifications */}
      <div ref={announcementRef} aria-live="polite" className="sr-only" />
    </Popover>
  );
}

function NotificationPanel({
  notifications,
  unreadCount,
  loading,
  onMarkAllAsRead,
  onClickNotification,
}: {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  onMarkAllAsRead: () => void;
  onClickNotification: (n: Notification) => void;
}) {
  return (
    <>
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Notifications</h3>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={onMarkAllAsRead}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Mark all as read
          </button>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-3 px-4 py-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="size-4 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && notifications.length === 0 && (
        <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
          <BellOff className="size-8 text-muted-foreground/50" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">
            All clear
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            No new notifications to review.
          </p>
        </div>
      )}

      {/* Notification list */}
      {!loading && notifications.length > 0 && (
        <div className="max-h-96 overflow-y-auto">
          {notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onClickNotification={onClickNotification}
            />
          ))}
        </div>
      )}
    </>
  );
}
