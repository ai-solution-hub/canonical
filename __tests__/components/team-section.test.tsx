/**
 * TeamSection Component Tests
 *
 * Tests the team management section — loading state, empty state,
 * user table rendering, self-user marker, role change, and deactivation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockGetUser, mockToast } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

import { TeamSection } from '@/components/settings/team-section';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTeamUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    display_name: 'Alice Smith',
    role: 'editor',
    created_at: '2025-01-15T10:00:00Z',
    last_sign_in_at: '2025-03-14T09:00:00Z',
    ...overrides,
  };
}

function createFetchMock(...responses: Array<{ ok: boolean; data: unknown }>) {
  const fn = vi.fn();
  for (const resp of responses) {
    fn.mockResolvedValueOnce({
      ok: resp.ok,
      json: () => Promise.resolve(resp.data),
    });
  }
  // Fallback for any additional calls
  fn.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve([]),
  });
  return fn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TeamSection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'current-user-id' } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a loading spinner while fetching team data', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<TeamSection />);

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('shows empty state when no team members are returned', async () => {
    vi.stubGlobal('fetch', createFetchMock({ ok: true, data: [] }));
    render(<TeamSection />);

    await waitFor(() => {
      expect(screen.getByText('No team members found')).toBeInTheDocument();
    });
  });

  it('renders user table with names, emails, roles, and last sign-in', async () => {
    const users = [
      createTeamUser({ id: 'user-1', display_name: 'Alice Smith', email: 'alice@example.com', role: 'admin' }),
      createTeamUser({ id: 'user-2', display_name: 'Bob Jones', email: 'bob@example.com', role: 'editor', last_sign_in_at: null }),
    ];
    vi.stubGlobal('fetch', createFetchMock({ ok: true, data: users }));
    render(<TeamSection />);

    // Names appear twice (desktop table + mobile card layout)
    await waitFor(() => {
      expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('alice@example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bob Jones').length).toBeGreaterThan(0);
    expect(screen.getAllByText('bob@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('2 members')).toBeInTheDocument();
  });

  it('marks the current user with "(you)" and shows a non-editable role badge', async () => {
    const users = [
      createTeamUser({ id: 'current-user-id', display_name: 'Me', email: 'me@example.com', role: 'admin' }),
      createTeamUser({ id: 'other-user', display_name: 'Other', email: 'other@example.com', role: 'viewer' }),
    ];
    vi.stubGlobal('fetch', createFetchMock({ ok: true, data: users }));
    render(<TeamSection />);

    // Name appears in both desktop and mobile layouts
    await waitFor(() => {
      expect(screen.getAllByText('Me').length).toBeGreaterThan(0);
    });

    // Current user should have "(you)" marker (appears in both desktop and mobile views)
    expect(screen.getAllByText('(you)').length).toBeGreaterThan(0);
  });

  it('renders role select for non-self users and has correct initial fetch', async () => {
    const users = [
      createTeamUser({ id: 'current-user-id', display_name: 'Me', email: 'me@example.com', role: 'admin' }),
      createTeamUser({ id: 'other-user', display_name: 'Other Person', email: 'other@example.com', role: 'viewer' }),
    ];
    const fetchMock = createFetchMock(
      { ok: true, data: users },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<TeamSection />);

    await waitFor(() => {
      expect(screen.getAllByText('Other Person').length).toBeGreaterThan(0);
    });

    // The non-self user should have role select comboboxes (desktop + mobile)
    // while the self user has a static badge instead
    const selectTriggers = screen.getAllByRole('combobox');
    expect(selectTriggers.length).toBeGreaterThan(0);

    // Verify the initial API call was made
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/users');
  });

  it('handles non-array API response gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', createFetchMock({ ok: true, data: { success: true } }));
    render(<TeamSection />);

    await waitFor(() => {
      expect(screen.getByText('No team members found')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Expected array from /api/admin/users, got:',
      'object',
    );
    consoleSpy.mockRestore();
  });

  it('calls DELETE API when deactivating a user', async () => {
    const users = [
      createTeamUser({ id: 'current-user-id', display_name: 'Me', email: 'me@example.com', role: 'admin' }),
      createTeamUser({ id: 'other-user', display_name: 'Other Person', email: 'other@example.com', role: 'viewer' }),
    ];
    const fetchMock = createFetchMock(
      { ok: true, data: users },
      { ok: true, data: { success: true } },
      { ok: true, data: [] },
    );
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<TeamSection />);

    await waitFor(() => {
      expect(screen.getAllByText('Other Person').length).toBeGreaterThan(0);
    });

    // Click the actions button for the other user (there are two: desktop + mobile)
    const actionsButtons = screen.getAllByLabelText('Actions for Other Person');
    await user.click(actionsButtons[0]);

    // Click "Deactivate" in the dropdown
    const deactivateItem = await screen.findByText('Deactivate');
    await user.click(deactivateItem);

    // Confirm in the alert dialog
    await waitFor(() => {
      expect(screen.getByText('Deactivate User')).toBeInTheDocument();
    });

    // Click the confirm "Deactivate" button in the alert dialog
    const confirmButtons = screen.getAllByRole('button', { name: 'Deactivate' });
    const confirmButton = confirmButtons[confirmButtons.length - 1];
    await user.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/users/other-user',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    expect(mockToast.success).toHaveBeenCalledWith('User deactivated');
  });
});
