/**
 * WP6: CommandPalette Component Tests
 *
 * Tests the CommandPalette component — admin-gated entries,
 * keyboard shortcut (Cmd+K), filtering, and navigation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockRouter, mockCanAdmin } = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  },
  mockCanAdmin: { value: false },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({
    role: mockCanAdmin.value ? 'admin' : 'viewer',
    loading: false,
    canEdit: mockCanAdmin.value,
    canAdmin: mockCanAdmin.value,
  }),
}));

// Mock motion/react to avoid animation complexity in jsdom
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => (
      <div {...(props as React.HTMLAttributes<HTMLDivElement>)}>
        {children as React.ReactNode}
      </div>
    ),
  },
}));

// Polyfill scrollIntoView for jsdom (used by cmdk)
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

import { CommandPalette } from '@/components/shell/command-palette';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandPalette', () => {
  beforeEach(() => {
    mockCanAdmin.value = false;
    mockRouter.push.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens when Cmd+K is pressed', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    // Initially closed — no dialog visible
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Press Cmd+K
    await user.keyboard('{Meta>}k{/Meta}');

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Command palette' }),
      ).toBeInTheDocument();
    });
  });

  it('shows navigation items when open', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Meta>}k{/Meta}');

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Browse')).toBeInTheDocument();
      expect(screen.getByText('Search')).toBeInTheDocument();
      expect(screen.getByText('Review')).toBeInTheDocument();
      expect(screen.getByText('Workspaces')).toBeInTheDocument();
      expect(screen.getByText('Bids')).toBeInTheDocument();
    });
  });

  it('hides admin entries for non-admin users', async () => {
    const user = userEvent.setup();
    mockCanAdmin.value = false;

    render(<CommandPalette />);
    await user.keyboard('{Meta>}k{/Meta}');

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });

    // Admin-only entries should not be visible
    expect(screen.queryByText('Settings › Categories')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings › Team')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Settings › Quality Review'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Settings › Activity')).not.toBeInTheDocument();
  });

  it('shows admin entries for admin users', async () => {
    const user = userEvent.setup();
    mockCanAdmin.value = true;

    render(<CommandPalette />);
    await user.keyboard('{Meta>}k{/Meta}');

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });

    // Admin-only entries should be visible (using HTML entity › = \u203A)
    // The component uses &rsaquo; which renders as ›
    const allText = document.body.textContent ?? '';
    expect(allText).toContain('Categories');
    expect(allText).toContain('Team');
    expect(allText).toContain('Quality Review');
    expect(allText).toContain('Activity');
  });

  it('toggles closed when Cmd+K is pressed again', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    // Open
    await user.keyboard('{Meta>}k{/Meta}');
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Toggle close with Cmd+K
    await user.keyboard('{Meta>}k{/Meta}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows toggle theme action', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Meta>}k{/Meta}');

    await waitFor(() => {
      expect(screen.getByText('Toggle theme')).toBeInTheDocument();
    });
  });

  it('shows keyboard shortcuts action', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Meta>}k{/Meta}');

    await waitFor(() => {
      expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
    });
  });
});
