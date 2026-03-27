/**
 * NotificationBell Component Tests
 *
 * Tests the NotificationBell component which displays a bell icon with
 * an unread count badge, a popover with notification list, and mark-as-read
 * functionality. Uses the useNotifications hook to fetch/manage notifications.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockRouter,
  mockNotifications,
  mockUnreadCount,
  mockLoading,
  mockMarkAsRead,
  mockMarkAllAsRead,
} = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  },
  mockNotifications: { value: [] as Array<{
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
  }> },
  mockUnreadCount: { value: 0 },
  mockLoading: { value: false },
  mockMarkAsRead: vi.fn(),
  mockMarkAllAsRead: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: () => ({
    notifications: mockNotifications.value,
    unreadCount: mockUnreadCount.value,
    loading: mockLoading.value,
    markAsRead: mockMarkAsRead,
    markAllAsRead: mockMarkAllAsRead,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/format', () => ({
  formatRelativeDate: (dateString: string | null) => {
    if (!dateString) return '';
    return '2 days ago';
  },
}));

import { NotificationBell } from '@/components/shell/notification-bell';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createNotification(overrides: Partial<{
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
}> = {}) {
  return {
    id: overrides.id ?? 'n-1',
    user_id: overrides.user_id ?? 'user-1',
    type: overrides.type ?? 'governance_review_needed',
    entity_type: overrides.entity_type ?? 'content_item',
    entity_id: overrides.entity_id ?? 'item-123',
    title: overrides.title ?? 'Review needed',
    message: overrides.message ?? 'Content item requires governance review',
    read_at: overrides.read_at ?? null,
    dismissed_at: overrides.dismissed_at ?? null,
    expires_at: overrides.expires_at ?? null,
    created_at: overrides.created_at ?? '2026-03-07T10:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications.value = [];
    mockUnreadCount.value = 0;
    mockLoading.value = false;
  });

  it('renders bell icon button', () => {
    render(<NotificationBell />);

    const button = screen.getByRole('button', { name: 'Notifications' });
    expect(button).toBeInTheDocument();
  });

  it('shows unread count badge when notifications exist', () => {
    mockUnreadCount.value = 3;

    render(<NotificationBell />);

    const button = screen.getByRole('button', { name: 'Notifications (3 unread)' });
    expect(button).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('hides badge when no unread notifications', () => {
    mockUnreadCount.value = 0;

    render(<NotificationBell />);

    const button = screen.getByRole('button', { name: 'Notifications' });
    expect(button).toBeInTheDocument();
    // No count badge should appear
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows 9+ when unread count exceeds 9', () => {
    mockUnreadCount.value = 15;

    render(<NotificationBell />);

    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('opens popover on click and shows notification list', async () => {
    const user = userEvent.setup();
    const notification = createNotification({ title: 'ISO 27001 review needed' });
    mockNotifications.value = [notification];
    mockUnreadCount.value = 1;

    render(<NotificationBell />);

    const button = screen.getByRole('button', { name: 'Notifications (1 unread)' });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('ISO 27001 review needed')).toBeInTheDocument();
    });
  });

  it('displays notification message text', async () => {
    const user = userEvent.setup();
    const notification = createNotification({
      title: 'Freshness expired',
      message: 'Security policy document is now stale',
    });
    mockNotifications.value = [notification];
    mockUnreadCount.value = 1;

    render(<NotificationBell />);

    await user.click(screen.getByRole('button', { name: 'Notifications (1 unread)' }));

    await waitFor(() => {
      expect(screen.getByText('Security policy document is now stale')).toBeInTheDocument();
    });
  });

  it('shows empty state when there are no notifications', async () => {
    const user = userEvent.setup();
    mockNotifications.value = [];
    mockUnreadCount.value = 0;

    render(<NotificationBell />);

    await user.click(screen.getByRole('button', { name: 'Notifications' }));

    await waitFor(() => {
      expect(screen.getByText('All clear')).toBeInTheDocument();
      expect(screen.getByText('No new notifications to review.')).toBeInTheDocument();
    });
  });

  it('calls markAsRead and navigates when notification is clicked', async () => {
    const user = userEvent.setup();
    const notification = createNotification({
      id: 'n-42',
      entity_id: 'item-abc',
      title: 'Review required',
    });
    mockNotifications.value = [notification];
    mockUnreadCount.value = 1;

    render(<NotificationBell />);

    // Open popover
    await user.click(screen.getByRole('button', { name: 'Notifications (1 unread)' }));

    await waitFor(() => {
      expect(screen.getByText('Review required')).toBeInTheDocument();
    });

    // Click on the notification
    await user.click(screen.getByText('Review required'));

    expect(mockMarkAsRead).toHaveBeenCalledWith(['n-42']);
    expect(mockRouter.push).toHaveBeenCalledWith('/item/item-abc');
  });

  it('navigates to diff review page for source_document notifications', async () => {
    const user = userEvent.setup();
    const notification = createNotification({
      id: 'n-doc-1',
      entity_type: 'source_document',
      entity_id: 'doc-uuid-123',
      type: 'source_document_updated',
      title: 'Source document updated',
    });
    mockNotifications.value = [notification];
    mockUnreadCount.value = 1;

    render(<NotificationBell />);

    await user.click(screen.getByRole('button', { name: 'Notifications (1 unread)' }));

    await waitFor(() => {
      expect(screen.getByText('Source document updated')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Source document updated'));

    expect(mockMarkAsRead).toHaveBeenCalledWith(['n-doc-1']);
    expect(mockRouter.push).toHaveBeenCalledWith('/documents/doc-uuid-123/diff');
  });

  it('shows "Mark all as read" button when there are unread notifications', async () => {
    const user = userEvent.setup();
    mockNotifications.value = [
      createNotification({ id: 'n-1', read_at: null }),
      createNotification({ id: 'n-2', read_at: null, title: 'Another notification' }),
    ];
    mockUnreadCount.value = 2;

    render(<NotificationBell />);

    await user.click(screen.getByRole('button', { name: 'Notifications (2 unread)' }));

    await waitFor(() => {
      expect(screen.getByText('Mark all as read')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Mark all as read'));

    expect(mockMarkAllAsRead).toHaveBeenCalled();
  });
});

// ===========================================================================
// Notification icon mapping tests (Finding 7 fix)
// ===========================================================================

describe('NotificationBell — icon mapping correctness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications.value = [];
    mockUnreadCount.value = 0;
    mockLoading.value = false;
  });

  // Valid governance types per DB constraint
  const VALID_GOVERNANCE_TYPES = [
    'governance_review_needed',
    'governance_approve',
    'governance_request_changes',
    'governance_revert',
  ];

  // Additional notification types that should have icons
  const ADDITIONAL_MAPPED_TYPES = [
    'quality_flag',
    'freshness_transition',
    'owner_content_stale',
    'owner_content_updated',
    'date_expiry_approaching',
    'coverage_alert',
    'content_gap',
  ];

  // INVALID types that used to be in the icon map (Finding 7 bug)
  const INVALID_TYPES = [
    'governance_request_update',
    'governance_reject',
  ];

  it.each(VALID_GOVERNANCE_TYPES)(
    'renders without error for governance type: %s',
    async (type) => {
      const user = userEvent.setup();
      mockNotifications.value = [createNotification({ type, title: `Type: ${type}` })];
      mockUnreadCount.value = 1;

      render(<NotificationBell />);
      await user.click(screen.getByRole('button', { name: /Notifications/ }));

      await waitFor(() => {
        expect(screen.getByText(`Type: ${type}`)).toBeInTheDocument();
      });
    },
  );

  it.each(ADDITIONAL_MAPPED_TYPES)(
    'renders without error for non-governance type: %s',
    async (type) => {
      const user = userEvent.setup();
      mockNotifications.value = [createNotification({ type, title: `Type: ${type}` })];
      mockUnreadCount.value = 1;

      render(<NotificationBell />);
      await user.click(screen.getByRole('button', { name: /Notifications/ }));

      await waitFor(() => {
        expect(screen.getByText(`Type: ${type}`)).toBeInTheDocument();
      });
    },
  );

  it.each(INVALID_TYPES)(
    'renders gracefully for previously-invalid type: %s (falls back to default icon)',
    async (type) => {
      const user = userEvent.setup();
      mockNotifications.value = [createNotification({ type, title: `Fallback: ${type}` })];
      mockUnreadCount.value = 1;

      render(<NotificationBell />);
      await user.click(screen.getByRole('button', { name: /Notifications/ }));

      await waitFor(() => {
        expect(screen.getByText(`Fallback: ${type}`)).toBeInTheDocument();
      });
    },
  );
});
