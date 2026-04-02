/**
 * ActivitySection Component Tests
 *
 * Tests the activity section wrapper — filter selects and
 * ActivityFeed component integration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockActivityFeedProps } = vi.hoisted(() => ({
  mockActivityFeedProps: { value: null as Record<string, unknown> | null },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock the Select components with simple HTML selects for testability
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <div data-current-value={value}>
      <select
        data-testid={`native-select-${value}`}
        value={value}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {children}
      </select>
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
}));

// Stub the ActivityFeed to capture its props
vi.mock('@/components/dashboard/activity-feed', () => ({
  ActivityFeed: (props: Record<string, unknown>) => {
    mockActivityFeedProps.value = props;
    return (
      <div
        data-testid="activity-feed"
        data-event-filter={props.eventFilter}
        data-date-range={props.dateRange}
      >
        ActivityFeed
      </div>
    );
  },
}));

import { ActivitySection } from '@/components/settings/activity-section';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActivitySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActivityFeedProps.value = null;
  });

  it('renders filter selects for event type and date range', () => {
    render(<ActivitySection />);

    expect(screen.getByText('Activity Log')).toBeInTheDocument();

    // Event type options present
    expect(screen.getByText('All events')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Governance')).toBeInTheDocument();

    // Date range options present
    expect(screen.getByText('All time')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('This week')).toBeInTheDocument();
  });

  it('renders ActivityFeed component with default props', () => {
    render(<ActivitySection />);

    const feed = screen.getByTestId('activity-feed');
    expect(feed).toBeInTheDocument();
    expect(feed).toHaveAttribute('data-event-filter', 'all');
    expect(feed).toHaveAttribute('data-date-range', 'all');
  });

  it('passes updated filter values to ActivityFeed when changed', async () => {
    const user = userEvent.setup();

    render(<ActivitySection />);

    // Both selects default to 'all'; the first is the event type filter
    const allSelects = screen.getAllByTestId('native-select-all');
    const eventSelect = allSelects[0];
    await user.selectOptions(eventSelect, 'content');

    // Verify ActivityFeed received the updated prop
    const feed = screen.getByTestId('activity-feed');
    expect(feed).toHaveAttribute('data-event-filter', 'content');
  });
});
