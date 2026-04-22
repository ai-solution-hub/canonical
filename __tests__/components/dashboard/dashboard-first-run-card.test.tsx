/**
 * DashboardFirstRunCard Component Tests (P0-4 Phase 1)
 *
 * Tests role branching, persona hint interactions, dismiss behaviour,
 * toast notifications, and visual highlight state.
 * Spec §7.1 — tests 1-10.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockUpdateUser, mockGetUser, mockToast } = vi.hoisted(() => ({
  mockUpdateUser: vi.fn(),
  mockGetUser: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      updateUser: mockUpdateUser,
      getUser: mockGetUser,
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

// Stub localStorage
const localStorageMap = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) =>
    localStorageMap.set(key, value),
  ),
  removeItem: vi.fn((key: string) => localStorageMap.delete(key)),
  clear: vi.fn(() => localStorageMap.clear()),
  get length() {
    return localStorageMap.size;
  },
  key: vi.fn(() => null),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { DashboardFirstRunCard } from '@/components/dashboard/dashboard-first-run-card';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorageMap.clear();
  vi.clearAllMocks();
  mockUpdateUser.mockResolvedValue({ error: null });
  // Default: no persisted persona — the hydrate effect reads user_metadata
  // from supabase.auth.getUser() to restore the highlight.
  mockGetUser.mockResolvedValue({ data: { user: { user_metadata: {} } } });
});

// ---------------------------------------------------------------------------
// Tests — spec §7.1
// ---------------------------------------------------------------------------

describe('DashboardFirstRunCard', () => {
  // Test 1: Renders for admin role
  it('renders for admin role with "Import your first content" CTA', () => {
    render(<DashboardFirstRunCard role="admin" />);
    expect(screen.getByText('Welcome to Knowledge Hub')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Import your first content' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Configure settings' }),
    ).toBeInTheDocument();
  });

  // Test 2: Renders for editor role
  it('renders for editor role with "Create your first item" CTA', () => {
    render(<DashboardFirstRunCard role="editor" />);
    expect(screen.getByText('Welcome to Knowledge Hub')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Create your first item' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Browse the knowledge base' }),
    ).toBeInTheDocument();
  });

  // Test 3: Does not render for viewer role
  it('does not render for viewer role', () => {
    render(<DashboardFirstRunCard role="viewer" />);
    expect(
      screen.queryByTestId('dashboard-first-run-card'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Welcome to Knowledge Hub'),
    ).not.toBeInTheDocument();
  });

  // Test 4: Persona hint row visible
  it('renders persona hint row with three links', () => {
    render(<DashboardFirstRunCard role="admin" />);
    expect(
      screen.getByText("I'm primarily here for:"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Bid writing' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Account management' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Marketing content' }),
    ).toBeInTheDocument();
  });

  // Test 5: Persona hint click stores value
  it('stores primary_focus via supabase.auth.updateUser on persona click', async () => {
    const user = userEvent.setup();
    render(<DashboardFirstRunCard role="editor" />);

    await user.click(screen.getByRole('button', { name: 'Bid writing' }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({
        data: { primary_focus: 'bid_writing' },
      });
    });
  });

  // Test 6: Persona hint single-select (replaces previous value)
  it('replaces stored value when clicking a different persona hint', async () => {
    const user = userEvent.setup();
    render(<DashboardFirstRunCard role="editor" />);

    // First click
    await user.click(screen.getByRole('button', { name: 'Bid writing' }));
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({
        data: { primary_focus: 'bid_writing' },
      });
    });

    // Second click replaces the value
    await user.click(
      screen.getByRole('button', { name: 'Account management' }),
    );
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({
        data: { primary_focus: 'account_management' },
      });
    });
  });

  // Test 7: Persona hint highlight
  it('applies visual highlight to clicked persona hint', async () => {
    const user = userEvent.setup();
    render(<DashboardFirstRunCard role="editor" />);

    const bidButton = screen.getByRole('button', { name: 'Bid writing' });
    await user.click(bidButton);

    await waitFor(() => {
      expect(bidButton).toHaveAttribute('aria-pressed', 'true');
      expect(bidButton.className).toContain('text-primary');
    });

    // Other buttons should not be highlighted
    const accountButton = screen.getByRole('button', {
      name: 'Account management',
    });
    expect(accountButton).toHaveAttribute('aria-pressed', 'false');
  });

  // Test 8: Dismiss button hides card
  it('hides card when dismiss button is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardFirstRunCard role="admin" />);

    expect(
      screen.getByTestId('dashboard-first-run-card'),
    ).toBeInTheDocument();

    const dismissBtn = screen.getByRole('button', {
      name: /dismiss welcome card/i,
    });
    await user.click(dismissBtn);

    expect(
      screen.queryByTestId('dashboard-first-run-card'),
    ).not.toBeInTheDocument();
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'dashboard-first-run-dismissed',
      expect.any(String),
    );
  });

  // Test 9: Dismissed state persists
  it('does not render when localStorage dismiss key exists', () => {
    localStorageMap.set(
      'dashboard-first-run-dismissed',
      '2026-04-23T10:00:00.000Z',
    );
    render(<DashboardFirstRunCard role="admin" />);
    expect(
      screen.queryByTestId('dashboard-first-run-card'),
    ).not.toBeInTheDocument();
  });

  // Test 10: Toast on persona selection
  it('shows toast confirmation when persona link is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardFirstRunCard role="editor" />);

    await user.click(
      screen.getByRole('button', { name: 'Marketing content' }),
    );

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        "Preference saved — we'll tailor your experience.",
      );
    });
  });

  // Additional: admin primary CTA links to /item/new
  it('admin primary CTA links to /item/new', () => {
    render(<DashboardFirstRunCard role="admin" />);
    const link = screen.getByRole('link', {
      name: 'Import your first content',
    });
    expect(link).toHaveAttribute('href', '/item/new');
  });

  // Additional: admin secondary CTA links to /settings (OQ-2)
  it('admin secondary CTA links to /settings', () => {
    render(<DashboardFirstRunCard role="admin" />);
    const link = screen.getByRole('link', { name: 'Configure settings' });
    expect(link).toHaveAttribute('href', '/settings');
  });

  // Additional: editor secondary CTA links to /browse
  it('editor secondary CTA links to /browse', () => {
    render(<DashboardFirstRunCard role="editor" />);
    const link = screen.getByRole('link', {
      name: 'Browse the knowledge base',
    });
    expect(link).toHaveAttribute('href', '/browse');
  });

  // Additional: shows error toast on updateUser failure
  it('shows error toast when updateUser fails', async () => {
    mockUpdateUser.mockResolvedValue({
      error: new Error('Network error'),
    });
    const user = userEvent.setup();
    render(<DashboardFirstRunCard role="editor" />);

    await user.click(screen.getByRole('button', { name: 'Bid writing' }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Network error');
    });
  });

  // Additional: description text uses UK English
  it('renders description with UK English spelling', () => {
    render(<DashboardFirstRunCard role="admin" />);
    expect(
      screen.getByText(
        "Let's get your company knowledge organised.",
      ),
    ).toBeInTheDocument();
  });

  // Additional: hydrate selected persona from user_metadata on mount
  it('restores previously-saved persona highlight from user_metadata', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { user_metadata: { primary_focus: 'marketing' } } },
    });

    render(<DashboardFirstRunCard role="editor" />);

    const marketing = await screen.findByRole('button', {
      name: 'Marketing content',
    });
    await waitFor(() => {
      expect(marketing).toHaveAttribute('aria-pressed', 'true');
    });
    expect(
      screen.getByRole('button', { name: 'Bid writing' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });
});
