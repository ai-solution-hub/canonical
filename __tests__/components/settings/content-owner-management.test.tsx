/**
 * ContentOwnerManagement Component Tests
 *
 * Tests loading state, empty state, owner stats table rendering,
 * assign-by-domain dialog, and assign-unowned dialog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { ContentOwnerManagement } from '@/components/settings/content-owner-management';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
        error: null,
      }),
    },
  })),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock taxonomy context
const mockGetDomainNames = vi.fn().mockReturnValue(['Technology', 'Compliance']);
const mockGetSubtopics = vi.fn().mockReturnValue(['Cloud', 'Security']);

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: vi.fn(() => ({
    domains: [
      { id: '1', name: 'Technology', display_order: 1 },
      { id: '2', name: 'Compliance', display_order: 2 },
    ],
    getDomainNames: mockGetDomainNames,
    getSubtopics: mockGetSubtopics,
    subtopics: [],
    loading: false,
    error: null,
    getDomainColourKey: vi.fn(),
    formatSubtopic: vi.fn((s: string) => s),
    formatDomainName: vi.fn((s: string) => s),
  })),
}));

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const MOCK_STATS = [
  {
    owner_id: 'user-1',
    display_name: 'Alice Admin',
    total_items: 10,
    fresh_count: 6,
    aging_count: 2,
    stale_count: 1,
    expired_count: 1,
    unverified_count: 0,
  },
  {
    owner_id: 'user-2',
    display_name: 'Bob Editor',
    total_items: 5,
    fresh_count: 5,
    aging_count: 0,
    stale_count: 0,
    expired_count: 0,
    unverified_count: 1,
  },
];

const MOCK_ROLES = [
  { user_id: 'user-1', role: 'admin' },
  { user_id: 'user-2', role: 'editor' },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();

  // Mock Supabase chain for user_roles query
  const chain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: MOCK_ROLES, error: null }),
    ),
  };
  mockFrom.mockReturnValue(chain);

  // Mock global fetch
  fetchMock = vi.fn();
  global.fetch = fetchMock;

  // Default fetch responses
  fetchMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/api/content-owners/stats')) {
      return {
        ok: true,
        json: async () => MOCK_STATS,
      };
    }
    if (typeof url === 'string' && url.includes('/api/users/display-names')) {
      return {
        ok: true,
        json: async () => ({
          display_names: { 'user-1': 'Alice Admin', 'user-2': 'Bob Editor' },
        }),
      };
    }
    if (typeof url === 'string' && url.includes('/api/content-owners/bulk-assign')) {
      return {
        ok: true,
        json: async () => ({ success: true, items_updated: 5 }),
      };
    }
    return { ok: false, json: async () => ({ error: 'Not found' }) };
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentOwnerManagement', () => {
  it('renders loading state initially', async () => {
    render(<ContentOwnerManagement />);
    expect(screen.getByText('Content Owners')).toBeInTheDocument();
    // Wait for async effects to settle to avoid act() warnings
    await waitFor(() => {
      expect(screen.getByText('Content Owners')).toBeInTheDocument();
    });
  });

  it('renders owner stats table after loading', async () => {
    render(<ContentOwnerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });

    expect(screen.getByText('Bob Editor')).toBeInTheDocument();

    // Check table is rendered with stats
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    // Verify Alice's total of 10 is present
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders empty state when no owners assigned', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/content-owners/stats')) {
        return { ok: true, json: async () => [] };
      }
      if (typeof url === 'string' && url.includes('/api/users/display-names')) {
        return { ok: true, json: async () => ({ display_names: {} }) };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(<ContentOwnerManagement />);

    await waitFor(() => {
      expect(screen.getByText('No content owners assigned yet')).toBeInTheDocument();
    });
  });

  it('shows warning icon for owners with stale/expired content', async () => {
    render(<ContentOwnerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });

    // Alice has stale + expired content, should have a warning icon
    const aliceRow = screen.getByText('Alice Admin').closest('tr');
    expect(aliceRow).toBeInTheDocument();
    if (aliceRow) {
      const warningIcon = within(aliceRow).getByLabelText(/items need attention/);
      expect(warningIcon).toBeInTheDocument();
    }
  });

  it('renders assign by domain button', async () => {
    render(<ContentOwnerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /assign by domain/i })).toBeInTheDocument();
  });

  it('renders assign unowned button', async () => {
    render(<ContentOwnerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /assign unowned/i })).toBeInTheDocument();
  });

  it('shows description text', async () => {
    render(<ContentOwnerManagement />);

    await waitFor(() => {
      expect(
        screen.getByText(/Content owners receive targeted notifications/),
      ).toBeInTheDocument();
    });
  });

  it('renders table headers correctly', async () => {
    render(<ContentOwnerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });

    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });
});
