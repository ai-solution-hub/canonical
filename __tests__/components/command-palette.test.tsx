/**
 * WP6: CommandPalette Component Tests
 *
 * Tests the CommandPalette component — role-gated entries generated from
 * NAV_ZONES (id-118 C3 de-drift), keyboard shortcut (Cmd+K), filtering, and
 * navigation. Asserting against the real NAV_ZONES data (rather than
 * duplicating hardcoded labels/hrefs) keeps this test honest about BI-18
 * lockstep — it fails the moment the palette drifts from the shared config.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  NAV_ZONES,
  isEntryVisible,
  type NavEntry,
} from '@/components/shell/nav-config';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockRouter, mockUserRole } = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  },
  mockUserRole: {
    role: 'viewer' as string | null,
    loading: false,
    canEdit: false,
    canAdmin: false,
  },
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
  useUserRole: () => mockUserRole,
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

// Polyfill pointer + scrollIntoView for jsdom (used by cmdk + Radix)
import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
installRadixPointerShims();

import { CommandPalette } from '@/components/shell/command-palette';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setRole(role: 'viewer' | 'editor' | 'admin') {
  mockUserRole.role = role;
  mockUserRole.loading = false;
  mockUserRole.canEdit = role === 'editor' || role === 'admin';
  mockUserRole.canAdmin = role === 'admin';
}

function visibleEntries(role: {
  canEdit: boolean;
  canAdmin: boolean;
}): NavEntry[] {
  return NAV_ZONES.flatMap((zone) =>
    zone.entries.filter(
      (entry) => !entry.reserved && isEntryVisible(entry.visibility, role),
    ),
  );
}

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Meta>}k{/Meta}');
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandPalette', () => {
  beforeEach(() => {
    setRole('viewer');
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

  it('toggles closed when Cmd+K is pressed again', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await openPalette(user);

    // Toggle close with Cmd+K
    await user.keyboard('{Meta>}k{/Meta}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows the Home utility item regardless of role', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await openPalette(user);

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // BI-2/BI-18/BI-19: three zone Command.Groups generated from NAV_ZONES
  // ---------------------------------------------------------------------------

  describe('zone groups (BI-2, BI-18, BI-19)', () => {
    it('renders exactly the three ratified zone headings', async () => {
      setRole('admin'); // widest audience — every zone has visible members
      const user = userEvent.setup();
      render(<CommandPalette />);
      await openPalette(user);

      await waitFor(() => {
        expect(screen.getByText('Applications')).toBeInTheDocument();
        expect(screen.getByText('Knowledge')).toBeInTheDocument();
        expect(screen.getByText('Governance')).toBeInTheDocument();
      });

      // No stray fourth heading (e.g. the retired flat "Navigation" group)
      expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
    });

    it('lists every visible, non-reserved NAV_ZONES entry for an admin', async () => {
      setRole('admin');
      const user = userEvent.setup();
      render(<CommandPalette />);
      await openPalette(user);

      for (const entry of visibleEntries({ canEdit: true, canAdmin: true })) {
        await waitFor(() => {
          expect(screen.getByText(entry.label)).toBeInTheDocument();
        });
      }
    });

    it('does not render the retired Workspaces or Bids labels', async () => {
      setRole('admin');
      const user = userEvent.setup();
      render(<CommandPalette />);
      await openPalette(user);

      await waitFor(() => {
        expect(screen.getByText('Applications')).toBeInTheDocument();
      });

      expect(screen.queryByText('Workspaces')).not.toBeInTheDocument();
      expect(screen.queryByText('Bids')).not.toBeInTheDocument();
    });

    it('renders the Concepts entry now the /okf landing has shipped ({132.32} LI-8)', async () => {
      setRole('admin');
      const user = userEvent.setup();
      render(<CommandPalette />);
      await openPalette(user);

      await waitFor(() => {
        expect(screen.getByText('Concepts')).toBeInTheDocument();
      });
    });

    it('routes to the NAV_ZONES href for every visible entry (lockstep w/ site-header)', async () => {
      setRole('admin');
      const user = userEvent.setup();
      render(<CommandPalette />);

      for (const entry of visibleEntries({ canEdit: true, canAdmin: true })) {
        await openPalette(user);
        await user.click(screen.getByText(entry.label));

        await waitFor(() => {
          expect(mockRouter.push).toHaveBeenCalledWith(entry.href);
        });
        mockRouter.push.mockClear();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // BI-20/BI-21: role-gating parity with the shared isEntryVisible predicate
  // ---------------------------------------------------------------------------

  describe('role gating (BI-20, BI-21)', () => {
    it('shows every Knowledge-zone entry uniformly for a viewer (BI-20)', async () => {
      setRole('viewer');
      const user = userEvent.setup();
      render(<CommandPalette />);
      await openPalette(user);

      const knowledgeZone = NAV_ZONES.find((z) => z.id === 'knowledge')!;
      for (const entry of knowledgeZone.entries.filter((e) => !e.reserved)) {
        await waitFor(() => {
          expect(screen.getByText(entry.label)).toBeInTheDocument();
        });
      }
    });

    it('hides edit-gated Applications/Governance entries for a viewer (BI-21)', async () => {
      setRole('viewer');
      const user = userEvent.setup();
      render(<CommandPalette />);
      await openPalette(user);

      await waitFor(() => {
        expect(screen.getByText('Procurement')).toBeInTheDocument();
      });

      expect(screen.queryByText('Intelligence')).not.toBeInTheDocument();
      expect(screen.queryByText('Review')).not.toBeInTheDocument();
      expect(screen.queryByText('Coverage')).not.toBeInTheDocument();
      expect(screen.queryByText('Provenance')).not.toBeInTheDocument();
    });

    it('shows edit-gated entries but not admin-only Provenance for an editor', async () => {
      setRole('editor');
      const user = userEvent.setup();
      render(<CommandPalette />);
      await openPalette(user);

      await waitFor(() => {
        expect(screen.getByText('Intelligence')).toBeInTheDocument();
        expect(screen.getByText('Review')).toBeInTheDocument();
        expect(screen.getByText('Coverage')).toBeInTheDocument();
      });

      expect(screen.queryByText('Provenance')).not.toBeInTheDocument();
    });

    it('shows Provenance under Governance for an admin', async () => {
      setRole('admin');
      const user = userEvent.setup();
      render(<CommandPalette />);
      await openPalette(user);

      await waitFor(() => {
        expect(screen.getByText('Provenance')).toBeInTheDocument();
      });
    });

    it('hides the admin Settings fan-out for non-admin users', async () => {
      setRole('viewer');
      const user = userEvent.setup();
      render(<CommandPalette />);
      await openPalette(user);

      await waitFor(() => {
        expect(screen.getByText('Home')).toBeInTheDocument();
      });

      expect(
        screen.queryByText('Settings › Categories'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Settings › Team')).not.toBeInTheDocument();
      expect(
        screen.queryByText('Settings › Quality Review'),
      ).not.toBeInTheDocument();
    });

    it('shows the admin Settings fan-out for admin users', async () => {
      setRole('admin');
      const user = userEvent.setup();
      render(<CommandPalette />);
      await openPalette(user);

      await waitFor(() => {
        expect(screen.getByText('Home')).toBeInTheDocument();
      });

      const allText = document.body.textContent ?? '';
      expect(allText).toContain('Categories');
      expect(allText).toContain('Team');
      expect(allText).toContain('Quality Review');
    });
  });

  // ---------------------------------------------------------------------------
  // Utilities + Actions kept as-is (Home, Settings, theme, keyboard shortcuts)
  // ---------------------------------------------------------------------------

  it('shows the Settings utility item outside the zone groups', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await openPalette(user);

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  it('shows toggle theme action', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await openPalette(user);

    await waitFor(() => {
      expect(screen.getByText('Toggle theme')).toBeInTheDocument();
    });
  });

  it('shows keyboard shortcuts action', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await openPalette(user);

    await waitFor(() => {
      expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // P0-18 (DECISIONS.md v4.1 §3.1): Enter-gate removal.
  // Typing in the palette + Enter must submit the top filtered result
  // (standard cmdk behaviour), rather than being swallowed by a
  // word-count gate that only fired for queries >3 words.
  // ---------------------------------------------------------------------------

  it('submits the top result when Enter is pressed on a short query', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await openPalette(user);

    const input = await screen.findByPlaceholderText(/Search /);
    // Short query (<=3 words) — pre-fix this would be swallowed because
    // the gate only fired handleSearchSubmit when word count > 3, while
    // cmdk's top-result selection was also disrupted by the custom handler.
    await user.type(input, 'home');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/');
    });
  });

  it('submits the top result when Enter is pressed on a multi-word query', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await openPalette(user);

    const input = await screen.findByPlaceholderText(/Search /);
    // Multi-word query matching the (unchanged) Settings utility item's
    // value verbatim. Post-fix: Enter routes through the highlighted item
    // (cmdk native), not the removed /browse?q= search fallback.
    await user.type(input, 'settings preferences profile');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/settings?section=profile');
    });
    // Gate is gone: we must not route via the old search fallback which
    // used /browse?q=<encoded query>.
    const pushedPaths = mockRouter.push.mock.calls.map((c) => c[0] as string);
    expect(pushedPaths.some((p) => p.startsWith('/browse?q='))).toBe(false);
  });

  it('does not render the "Press Enter to search" fallback copy', async () => {
    // Copy no longer promises a behaviour that does not exist
    // (P0-18 removed the >3-word search fallback).
    const user = userEvent.setup();
    render(<CommandPalette />);

    await openPalette(user);

    expect(
      screen.queryByText(/Press Enter to search/i),
    ).not.toBeInTheDocument();
  });
});
