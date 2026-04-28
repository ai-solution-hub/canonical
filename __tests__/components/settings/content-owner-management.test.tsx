/**
 * ContentOwnerManagement Component Tests
 *
 * Tests loading state, empty state, owner stats table rendering,
 * and the single Assign Owner dialog with scope toggle (unowned / by domain).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const mockGetDomainNames = vi
  .fn()
  .mockReturnValue(['Technology', 'Compliance']);
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

let fetchMock: Mock<(...args: unknown[]) => Promise<unknown>>;

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
  fetchMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
  global.fetch = fetchMock as unknown as typeof globalThis.fetch;

  // Default fetch responses
  fetchMock.mockImplementation(async (...args: unknown[]) => {
    const url = args[0] as string;
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
    if (
      typeof url === 'string' &&
      url.includes('/api/content-owners/bulk-assign')
    ) {
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
    fetchMock.mockImplementation(async (...args: unknown[]) => {
      const url = args[0] as string;
      if (
        typeof url === 'string' &&
        url.includes('/api/content-owners/stats')
      ) {
        return { ok: true, json: async () => [] };
      }
      if (typeof url === 'string' && url.includes('/api/users/display-names')) {
        return { ok: true, json: async () => ({ display_names: {} }) };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(<ContentOwnerManagement />);

    await waitFor(() => {
      expect(
        screen.getByText('No content owners assigned yet'),
      ).toBeInTheDocument();
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
      const warningIcon =
        within(aliceRow).getByLabelText(/items need attention/);
      expect(warningIcon).toBeInTheDocument();
    }
  });

  it('renders single Assign owner button (not two separate buttons)', async () => {
    render(<ContentOwnerManagement />);

    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: /assign owner/i }),
    ).toBeInTheDocument();

    // Old separate buttons should not exist
    expect(
      screen.queryByRole('button', { name: /assign by domain/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /assign unowned/i }),
    ).not.toBeInTheDocument();
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

  describe('Assign dialog — scope toggle', () => {
    it('opens dialog with "Unowned only" scope selected by default', async () => {
      const user = userEvent.setup();
      render(<ContentOwnerManagement />);

      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign owner/i }));

      // Dialog title and description
      expect(screen.getByText('Assign content owner')).toBeInTheDocument();
      expect(
        screen.getByText(/Assign unowned content items to a team member/),
      ).toBeInTheDocument();

      // Scope radio — "Unowned only" should be checked
      const unownedRadio = screen.getByRole('radio', { name: /unowned only/i });
      expect(unownedRadio).toBeChecked();

      // "By domain" should not be checked
      const byDomainRadio = screen.getByRole('radio', { name: /by domain/i });
      expect(byDomainRadio).not.toBeChecked();

      // Domain filter fields should NOT be visible in unowned scope
      expect(screen.queryByLabelText(/^Domain$/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/content type/i)).not.toBeInTheDocument();

      // Owner picker should be visible
      expect(screen.getByLabelText(/^Owner$/)).toBeInTheDocument();
    });

    it('shows domain filters when "By domain" scope is selected', async () => {
      const user = userEvent.setup();
      render(<ContentOwnerManagement />);

      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign owner/i }));

      // Switch to by-domain scope
      const byDomainRadio = screen.getByRole('radio', { name: /by domain/i });
      await user.click(byDomainRadio);

      expect(byDomainRadio).toBeChecked();

      // Domain filter fields should now be visible
      expect(screen.getByLabelText(/^Domain$/)).toBeInTheDocument();
      expect(screen.getByLabelText(/content type/i)).toBeInTheDocument();

      // Owner picker still visible
      expect(screen.getByLabelText(/^Owner$/)).toBeInTheDocument();
    });

    it('hides domain filters when switching back to "Unowned only"', async () => {
      const user = userEvent.setup();
      render(<ContentOwnerManagement />);

      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign owner/i }));

      // Switch to by-domain
      await user.click(screen.getByRole('radio', { name: /by domain/i }));
      expect(screen.getByLabelText(/^Domain$/)).toBeInTheDocument();

      // Switch back to unowned
      await user.click(screen.getByRole('radio', { name: /unowned only/i }));
      expect(screen.queryByLabelText(/^Domain$/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/content type/i)).not.toBeInTheDocument();
    });

    it('keeps owner picker visible across scope changes', async () => {
      const user = userEvent.setup();
      render(<ContentOwnerManagement />);

      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign owner/i }));

      // Owner select visible in unowned scope
      expect(screen.getByLabelText(/^Owner$/)).toBeInTheDocument();

      // Switch scopes — owner field still present
      await user.click(screen.getByRole('radio', { name: /by domain/i }));
      expect(screen.getByLabelText(/^Owner$/)).toBeInTheDocument();

      await user.click(screen.getByRole('radio', { name: /unowned only/i }));
      expect(screen.getByLabelText(/^Owner$/)).toBeInTheDocument();
    });
  });

  describe('Assign dialog — submit controls', () => {
    it('disables Assign button when no owner is selected', async () => {
      const user = userEvent.setup();
      render(<ContentOwnerManagement />);

      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign owner/i }));

      const dialog = screen.getByRole('dialog');
      const assignBtn = within(dialog).getByRole('button', {
        name: /^assign$/i,
      });
      expect(assignBtn).toBeDisabled();
    });

    it('renders Cancel button in dialog', async () => {
      const user = userEvent.setup();
      render(<ContentOwnerManagement />);

      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign owner/i }));

      const dialog = screen.getByRole('dialog');
      expect(
        within(dialog).getByRole('button', { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    it('renders scope radio group with both options', async () => {
      const user = userEvent.setup();
      render(<ContentOwnerManagement />);

      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign owner/i }));

      const radios = screen.getAllByRole('radio');
      expect(radios).toHaveLength(2);
      expect(
        screen.getByRole('radio', { name: /unowned only/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('radio', { name: /by domain/i }),
      ).toBeInTheDocument();
    });
  });

  describe('Assign dialog — reset on close', () => {
    it('resets scope to "Unowned only" when dialog is closed via Cancel', async () => {
      const user = userEvent.setup();
      render(<ContentOwnerManagement />);

      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      // Open dialog and switch to by-domain
      await user.click(screen.getByRole('button', { name: /assign owner/i }));
      await user.click(screen.getByRole('radio', { name: /by domain/i }));
      expect(screen.getByLabelText(/^Domain$/)).toBeInTheDocument();

      // Close via Cancel
      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /cancel/i }));

      // Re-open — should be back to "Unowned only" default
      await user.click(screen.getByRole('button', { name: /assign owner/i }));

      const unownedRadio = screen.getByRole('radio', { name: /unowned only/i });
      expect(unownedRadio).toBeChecked();
      expect(screen.queryByLabelText(/^Domain$/)).not.toBeInTheDocument();
    });

    it('resets scope when dialog is closed by clicking outside', async () => {
      const user = userEvent.setup();
      render(<ContentOwnerManagement />);

      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      // Open and switch scope
      await user.click(screen.getByRole('button', { name: /assign owner/i }));
      await user.click(screen.getByRole('radio', { name: /by domain/i }));

      // Close by pressing Escape (simulates clicking away)
      await user.keyboard('{Escape}');

      // Re-open — should be back to default
      await user.click(screen.getByRole('button', { name: /assign owner/i }));

      const unownedRadio = screen.getByRole('radio', { name: /unowned only/i });
      expect(unownedRadio).toBeChecked();
    });
  });

  describe('Assign dialog — content type options in by-domain scope', () => {
    it('renders all content type options when in by-domain scope', async () => {
      const user = userEvent.setup();
      render(<ContentOwnerManagement />);

      await waitFor(() => {
        expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /assign owner/i }));
      await user.click(screen.getByRole('radio', { name: /by domain/i }));

      // Content type select trigger should be visible
      expect(screen.getByLabelText(/content type/i)).toBeInTheDocument();
    });
  });
});
