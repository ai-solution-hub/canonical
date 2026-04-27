/**
 * TeamSection Component Tests
 *
 * Covers:
 * 1. Invite flow renders + submits
 * 2. Role change control renders + triggers mutation
 * 3. Deactivate flow renders + confirms + calls mutation
 * 4. Responsive rendering — single list, no duplicate tree
 * 5. No regression on settings page ?section=team routing
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TeamSection } from '@/components/settings/team-section';
import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const CURRENT_USER_ID = 'aaaaaaaa-1111-4000-8000-000000000001';
const OTHER_USER_ID = 'bbbbbbbb-2222-4000-8000-000000000002';
const THIRD_USER_ID = 'cccccccc-3333-4000-8000-000000000003';

const MOCK_USERS = [
  {
    id: CURRENT_USER_ID,
    email: 'admin@example.com',
    display_name: 'Admin User',
    role: 'admin',
    created_at: '2026-01-01T00:00:00Z',
    last_sign_in_at: '2026-04-20T10:00:00Z',
  },
  {
    id: OTHER_USER_ID,
    email: 'editor@example.com',
    display_name: 'Editor User',
    role: 'editor',
    created_at: '2026-02-01T00:00:00Z',
    last_sign_in_at: '2026-04-19T09:00:00Z',
  },
  {
    id: THIRD_USER_ID,
    email: 'viewer@example.com',
    display_name: null,
    role: 'viewer',
    created_at: '2026-03-01T00:00:00Z',
    last_sign_in_at: null,
  },
];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fetchMock: Mock;

// Radix Select needs these pointer shims in jsdom
beforeEach(() => {
  installRadixPointerShims();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({
    data: { user: { id: CURRENT_USER_ID } },
  });

  fetchMock = vi.fn();
  global.fetch = fetchMock;

  // Default: return team members for GET /api/admin/users
  fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (
      url === '/api/admin/users' &&
      (!opts || opts.method === undefined || opts.method === 'GET')
    ) {
      return {
        ok: true,
        json: async () => MOCK_USERS,
      };
    }
    // Default fallback
    return { ok: true, json: async () => ({}) };
  });
});

// ---------------------------------------------------------------------------
// 1. Invite flow
// ---------------------------------------------------------------------------

describe('TeamSection — Invite flow', () => {
  it('renders the Invite User button', async () => {
    render(<TeamSection />);
    expect(
      await screen.findByRole('button', { name: /invite user/i }),
    ).toBeInTheDocument();
  });

  it('opens invite dialog and submits', async () => {
    const user = userEvent.setup();
    render(<TeamSection />);

    // Wait for loading to finish
    await screen.findByText('Admin User');

    // Open invite dialog
    await user.click(screen.getByRole('button', { name: /invite user/i }));
    expect(
      screen.getByText('Send an invitation email to add a new team member.'),
    ).toBeInTheDocument();

    // Fill form
    await user.type(screen.getByLabelText('Email Address'), 'new@example.com');
    await user.type(screen.getByLabelText('Display Name'), 'New Person');

    // Mock invite endpoint
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === '/api/admin/users/invite' && opts?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'new-id' }) };
      }
      // Re-fetch users after invite
      if (url === '/api/admin/users') {
        return { ok: true, json: async () => MOCK_USERS };
      }
      return { ok: true, json: async () => ({}) };
    });

    // Submit
    await user.click(screen.getByRole('button', { name: /send invitation/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/users/invite',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('new@example.com'),
        }),
      );
    });
  });

  it('shows error toast when invite fails', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();
    render(<TeamSection />);
    await screen.findByText('Admin User');

    await user.click(screen.getByRole('button', { name: /invite user/i }));
    await user.type(screen.getByLabelText('Email Address'), 'fail@example.com');

    fetchMock.mockImplementation(async (url: string, _opts?: RequestInit) => {
      if (url === '/api/admin/users/invite') {
        return {
          ok: false,
          json: async () => ({ error: 'User already exists' }),
        };
      }
      return { ok: true, json: async () => MOCK_USERS };
    });

    await user.click(screen.getByRole('button', { name: /send invitation/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('shows warning toast when invite has warnings', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();
    render(<TeamSection />);
    await screen.findByText('Admin User');

    await user.click(screen.getByRole('button', { name: /invite user/i }));
    await user.type(screen.getByLabelText('Email Address'), 'warn@example.com');

    fetchMock.mockImplementation(async (url: string, _opts?: RequestInit) => {
      if (url === '/api/admin/users/invite') {
        return {
          ok: true,
          json: async () => ({
            id: 'id',
            warnings: ['Role assignment failed'],
          }),
        };
      }
      return { ok: true, json: async () => MOCK_USERS };
    });

    await user.click(screen.getByRole('button', { name: /send invitation/i }));

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining('Role assignment failed'),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Role change
// ---------------------------------------------------------------------------

describe('TeamSection — Role change', () => {
  it('renders role select for other users but badge for self', async () => {
    render(<TeamSection />);
    await screen.findByText('Admin User');

    // Self (Admin User) should show a badge, not a select
    expect(screen.getByText('Admin')).toBeInTheDocument();

    // Other users should have role selects
    const roleSelects = screen.getAllByRole('combobox');
    // Two non-self users = 2 role selects (plus the invite dialog role select is not rendered yet)
    expect(roleSelects.length).toBe(2);
  });

  it('renders role select with current value for other users', async () => {
    render(<TeamSection />);
    await screen.findByText('Admin User');

    // The role selects for non-self users should exist and show current roles
    const roleSelect = screen.getByRole('combobox', {
      name: /role for editor user/i,
    });
    expect(roleSelect).toBeInTheDocument();
    // The displayed value in the trigger should reflect 'editor'
    expect(roleSelect).toHaveTextContent('Editor');
  });

  it('renders role select for viewer user with correct value', async () => {
    render(<TeamSection />);
    await screen.findByText('Admin User');

    const roleSelect = screen.getByRole('combobox', {
      name: /role for viewer/i,
    });
    expect(roleSelect).toBeInTheDocument();
    expect(roleSelect).toHaveTextContent('Viewer');
  });

  it('fires PATCH when role is changed for another user', async () => {
    const user = userEvent.setup();
    render(<TeamSection />);
    await screen.findByText('Admin User');

    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (
        typeof url === 'string' &&
        url === `/api/admin/users/${OTHER_USER_ID}` &&
        opts?.method === 'PATCH'
      ) {
        return { ok: true, json: async () => ({}) };
      }
      if (url === '/api/admin/users') {
        return { ok: true, json: async () => MOCK_USERS };
      }
      return { ok: true, json: async () => ({}) };
    });

    const roleSelect = screen.getByRole('combobox', {
      name: /role for editor user/i,
    });
    await user.click(roleSelect);

    const adminOption = await screen.findByRole('option', { name: /admin/i });
    await user.click(adminOption);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/users/${OTHER_USER_ID}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"role":"admin"'),
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Deactivate flow
// ---------------------------------------------------------------------------

describe('TeamSection — Deactivate flow', () => {
  it('renders inline Deactivate button for non-self users', async () => {
    render(<TeamSection />);
    await screen.findByText('Admin User');

    // Should have deactivate buttons for the 2 non-self users
    const deactivateButtons = screen.getAllByRole('button', {
      name: /deactivate/i,
    });
    expect(deactivateButtons.length).toBe(2);
  });

  it('does not render Deactivate button for self', async () => {
    render(<TeamSection />);
    await screen.findByText('Admin User');

    // The deactivate buttons should not have one for the current user
    const deactivateButtons = screen.getAllByRole('button', {
      name: /deactivate/i,
    });
    deactivateButtons.forEach((btn) => {
      expect(btn).not.toHaveAttribute('aria-label', 'Deactivate Admin User');
    });
  });

  it('opens confirm dialog and calls DELETE on confirm', async () => {
    const user = userEvent.setup();
    render(<TeamSection />);
    await screen.findByText('Admin User');

    // Mock for deactivate
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (
        typeof url === 'string' &&
        url.includes(`/api/admin/users/${OTHER_USER_ID}`) &&
        opts?.method === 'DELETE'
      ) {
        return { ok: true, json: async () => ({}) };
      }
      if (url === '/api/admin/users') {
        return { ok: true, json: async () => MOCK_USERS };
      }
      return { ok: true, json: async () => ({}) };
    });

    // Click the deactivate button for Editor User
    const editorDeactivateBtn = screen.getByRole('button', {
      name: /deactivate editor user/i,
    });
    await user.click(editorDeactivateBtn);

    // Confirm dialog should appear
    const dialog = screen.getByRole('alertdialog');
    expect(
      within(dialog).getByText(/are you sure you want to deactivate/i),
    ).toBeInTheDocument();

    // Click confirm
    const confirmAction = within(dialog).getByRole('button', {
      name: 'Deactivate',
    });
    await user.click(confirmAction);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/admin/users/${OTHER_USER_ID}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('shows error toast when deactivation fails', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();
    render(<TeamSection />);
    await screen.findByText('Admin User');

    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/admin/users/') &&
        opts?.method === 'DELETE'
      ) {
        return {
          ok: false,
          json: async () => ({ error: 'Forbidden' }),
        };
      }
      if (url === '/api/admin/users') {
        return { ok: true, json: async () => MOCK_USERS };
      }
      return { ok: true, json: async () => ({}) };
    });

    const editorDeactivateBtn = screen.getByRole('button', {
      name: /deactivate editor user/i,
    });
    await user.click(editorDeactivateBtn);

    const dialog = screen.getByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'Deactivate' }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Forbidden');
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Single responsive list — no duplicate tree
// ---------------------------------------------------------------------------

describe('TeamSection — Responsive single list', () => {
  it('renders users in a single list container (not duplicate desktop/mobile)', async () => {
    render(<TeamSection />);
    await screen.findByText('Admin User');

    // There should be exactly ONE list container with role="list"
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(1);

    // Each user should appear exactly once in the DOM
    const adminMatches = screen.getAllByText('Admin User');
    expect(adminMatches).toHaveLength(1);

    const editorMatches = screen.getAllByText('Editor User');
    expect(editorMatches).toHaveLength(1);
  });

  it('does not render aria-hidden duplicate layout', async () => {
    const { container } = render(<TeamSection />);
    await screen.findByText('Admin User');

    // No element should have aria-hidden="true" wrapping user data
    const ariaHiddenEls = container.querySelectorAll('[aria-hidden="true"]');
    ariaHiddenEls.forEach((el) => {
      // Only decorative icons should be aria-hidden, not user data containers
      expect(el.textContent).not.toContain('Editor User');
      expect(el.textContent).not.toContain('Admin User');
    });
  });

  it('displays email for all users', async () => {
    render(<TeamSection />);
    await screen.findByText('Admin User');

    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('editor@example.com')).toBeInTheDocument();
    expect(screen.getByText('viewer@example.com')).toBeInTheDocument();
  });

  it('falls back to email prefix when display_name is null', async () => {
    render(<TeamSection />);
    // Third user has display_name: null, email: viewer@example.com
    expect(await screen.findByText('viewer')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 5. Loading + empty states
// ---------------------------------------------------------------------------

describe('TeamSection — Loading and empty states', () => {
  it('shows loading spinner initially', () => {
    // Never resolve the fetch
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<TeamSection />);
    expect(
      screen.getByText('', { selector: '.animate-spin' }),
    ).toBeInTheDocument();
  });

  it('shows empty state when no users', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => [],
    }));

    render(<TeamSection />);
    expect(
      await screen.findByText('No team members found'),
    ).toBeInTheDocument();
  });

  it('shows member count', async () => {
    render(<TeamSection />);
    expect(await screen.findByText('3 members')).toBeInTheDocument();
  });

  it('shows singular "member" for one user', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => [MOCK_USERS[0]],
    }));

    render(<TeamSection />);
    expect(await screen.findByText('1 member')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 6. Self-identification
// ---------------------------------------------------------------------------

describe('TeamSection — Self identification', () => {
  it('shows "(you)" indicator for the current user', async () => {
    render(<TeamSection />);
    await screen.findByText('Admin User');

    // The "(you)" text should appear
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });
});
