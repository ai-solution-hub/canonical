/**
 * OwnedContentHealth Component Tests
 *
 * Tests rendering for various ownership states:
 * - User owns no content (returns null)
 * - User owns content, all healthy
 * - User owns content with stale/expired items
 * - Loading state
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OwnedContentHealth } from '@/components/dashboard/owned-content-health';

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockIs = vi.fn();

function makeChain() {
  const chain = {
    select: mockSelect.mockReturnThis(),
    eq: mockEq.mockReturnThis(),
    is: mockIs,
  };
  return chain;
}

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => makeChain()),
    auth: {
      getUser: () => mockGetUser(),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: authenticated user
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'test-user-id' } },
    error: null,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Configure mockIs to return sequential count values.
 * Each call to .is() resolves with the next count in the array.
 */
function configureCounts(stale: number, expired: number, total: number) {
  let callIndex = 0;
  const counts = [stale, expired, total];

  mockIs.mockImplementation(() => ({
    count: counts[callIndex++] ?? 0,
    data: null,
    error: null,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OwnedContentHealth', () => {
  it('renders loading state initially', () => {
    // Make getUser hang to keep loading
    mockGetUser.mockReturnValue(new Promise(() => {}));
    render(<OwnedContentHealth />);
    expect(screen.getByLabelText('Loading owned content health')).toBeInTheDocument();
  });

  it('renders nothing when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const { container } = render(<OwnedContentHealth />);

    await waitFor(() => {
      // Should render nothing (container empty or just the loading removed)
      expect(container.querySelector('[data-testid="owned-content-health"]')).not.toBeInTheDocument();
    });
  });

  it('renders nothing when user owns no content', async () => {
    configureCounts(0, 0, 0);

    const { container } = render(<OwnedContentHealth />);

    await waitFor(() => {
      expect(container.querySelector('[data-testid="owned-content-health"]')).not.toBeInTheDocument();
    });
  });

  it('renders healthy state when all owned content is fresh', async () => {
    configureCounts(0, 0, 8);

    render(<OwnedContentHealth />);

    await waitFor(() => {
      expect(screen.getByText(/8 owned items are all up to date/)).toBeInTheDocument();
    });

    expect(screen.getByText(/No stale or expired content/)).toBeInTheDocument();
  });

  it('renders warning state with stale and expired counts', async () => {
    configureCounts(3, 2, 10);

    render(<OwnedContentHealth />);

    await waitFor(() => {
      expect(screen.getByText(/5 of your 10 owned items need attention/)).toBeInTheDocument();
    });

    expect(screen.getByText(/3 stale, 2 expired/)).toBeInTheDocument();
    expect(screen.getByText('View my stale content')).toBeInTheDocument();
  });

  it('renders warning state with stale only', async () => {
    configureCounts(4, 0, 12);

    render(<OwnedContentHealth />);

    await waitFor(() => {
      expect(screen.getByText(/4 of your 12 owned items need attention/)).toBeInTheDocument();
    });

    expect(screen.getByText(/4 stale/)).toBeInTheDocument();
  });

  it('renders warning state with expired only', async () => {
    configureCounts(0, 1, 5);

    render(<OwnedContentHealth />);

    await waitFor(() => {
      expect(screen.getByText(/1 of your 5 owned items need attention/)).toBeInTheDocument();
    });

    expect(screen.getByText(/1 expired/)).toBeInTheDocument();
  });

  it('includes correct browse link', async () => {
    configureCounts(2, 1, 7);

    render(<OwnedContentHealth />);

    await waitFor(() => {
      expect(screen.getByText('View my stale content')).toBeInTheDocument();
    });

    const link = screen.getByText('View my stale content').closest('a');
    expect(link).toHaveAttribute('href', '/browse?owner=me&freshness=stale,expired');
  });

  it('handles singular item text correctly', async () => {
    configureCounts(1, 0, 1);

    render(<OwnedContentHealth />);

    await waitFor(() => {
      expect(screen.getByText(/1 of your 1 owned item needs attention/)).toBeInTheDocument();
    });
  });
});
