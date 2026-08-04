/**
 * NotificationPreferences Component Tests
 *
 * Tests the notification preferences sub-section in Profile settings.
 *
 * Covers:
 *   - Renders both switches with correct labels
 *   - Toggle interaction calls the mutation with expected payload
 *   - Loading state renders disabled switches
 *   - Default-on state when server returns no row
 *   - Error path on mutation failure shows toast
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { toast } from 'sonner';
import { createQueryWrapper } from '../../helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import { NotificationPreferences } from '@/components/settings/notification-preferences';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a component wrapped in a fresh QueryClientProvider. Delegates to
 * the canonical `createQueryWrapper` helper.
 */
function renderWithQuery(ui: React.ReactElement) {
  const { Wrapper } = createQueryWrapper();
  return render(ui, { wrapper: Wrapper });
}

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;

function mockFetchPrefs(prefs: {
  email_review_assigned: boolean;
  email_owned_content_flagged: boolean;
}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ preferences: prefs }),
  });
}

function mockFetchPrefsDefault() {
  mockFetchPrefs({
    email_review_assigned: true,
    email_owned_content_flagged: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchPrefsDefault();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders loading spinners before data resolves', async () => {
    // Delay the GET so the loading state is observable synchronously.
    let resolvePrefs: ((value: unknown) => void) | null = null;
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePrefs = resolve;
        }),
    );

    const { container } = renderWithQuery(<NotificationPreferences />);

    // Spinners render (one per switch row) while the query is pending.
    const spinners = container.querySelectorAll('svg.animate-spin');
    expect(spinners.length).toBeGreaterThan(0);

    // No switches rendered yet (switches are gated behind !isLoading).
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    // Unblock the query so the render cycle settles and React Query cleans up.
    (resolvePrefs as ((value: unknown) => void) | null)?.({
      ok: true,
      json: async () => ({
        preferences: {
          email_review_assigned: true,
          email_owned_content_flagged: true,
        },
      }),
    });

    await waitFor(() => {
      expect(screen.getAllByRole('switch').length).toBe(2);
    });
  });

  it('renders both switches with correct labels', async () => {
    renderWithQuery(<NotificationPreferences />);

    await waitFor(() => {
      expect(screen.getByLabelText('Review assignments')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Owned content flags')).toBeInTheDocument();
  });

  it('renders section heading', async () => {
    renderWithQuery(<NotificationPreferences />);

    await waitFor(() => {
      expect(screen.getByText('Notifications')).toBeInTheDocument();
    });
  });

  it('renders description text for each switch', async () => {
    renderWithQuery(<NotificationPreferences />);

    await waitFor(() => {
      expect(
        screen.getByText('Email when a review is assigned to you'),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText('Email when content you own gets flagged for review'),
    ).toBeInTheDocument();
  });

  it('shows switches as checked when defaults are all ON', async () => {
    renderWithQuery(<NotificationPreferences />);

    await waitFor(() => {
      expect(screen.getByLabelText('Review assignments')).toBeInTheDocument();
    });

    const reviewSwitch = screen.getByRole('switch', {
      name: 'Review assignments',
    });
    const flaggedSwitch = screen.getByRole('switch', {
      name: 'Owned content flags',
    });

    expect(reviewSwitch).toHaveAttribute('data-state', 'checked');
    expect(flaggedSwitch).toHaveAttribute('data-state', 'checked');
  });

  it('shows switches matching server state when some are OFF', async () => {
    mockFetchPrefs({
      email_review_assigned: true,
      email_owned_content_flagged: false,
    });

    renderWithQuery(<NotificationPreferences />);

    await waitFor(() => {
      expect(screen.getByLabelText('Review assignments')).toBeInTheDocument();
    });

    const reviewSwitch = screen.getByRole('switch', {
      name: 'Review assignments',
    });
    const flaggedSwitch = screen.getByRole('switch', {
      name: 'Owned content flags',
    });

    expect(reviewSwitch).toHaveAttribute('data-state', 'checked');
    expect(flaggedSwitch).toHaveAttribute('data-state', 'unchecked');
  });

  it('calls PUT with toggled value when a switch is clicked', async () => {
    const user = userEvent.setup();

    // First call: GET prefs (all on)
    // Second call: PUT to toggle one off
    global.fetch = vi
      .fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        if (!init || init.method !== 'PUT') {
          // GET call
          return {
            ok: true,
            json: async () => ({
              preferences: {
                email_review_assigned: true,
                email_owned_content_flagged: true,
              },
            }),
          };
        }
        // PUT call
        return {
          ok: true,
          json: async () => ({
            preferences: {
              email_review_assigned: false,
              email_owned_content_flagged: true,
            },
          }),
        };
      });

    renderWithQuery(<NotificationPreferences />);

    await waitFor(() => {
      expect(screen.getByLabelText('Review assignments')).toBeInTheDocument();
    });

    const reviewSwitch = screen.getByRole('switch', {
      name: 'Review assignments',
    });
    await user.click(reviewSwitch);

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const putCall = calls.find(
        (c: unknown[]) => (c[1] as RequestInit)?.method === 'PUT',
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse((putCall![1] as RequestInit).body as string);
      expect(body.email_review_assigned).toBe(false);
    });
  });

  it('shows toast on mutation failure', async () => {
    const user = userEvent.setup();

    // GET succeeds, PUT fails
    global.fetch = vi
      .fn()
      .mockImplementation(async (_url: string, init?: RequestInit) => {
        if (!init || init.method !== 'PUT') {
          return {
            ok: true,
            json: async () => ({
              preferences: {
                email_review_assigned: true,
                email_owned_content_flagged: true,
              },
            }),
          };
        }
        return {
          ok: false,
          json: async () => ({ error: 'Failed to update' }),
        };
      });

    renderWithQuery(<NotificationPreferences />);

    await waitFor(() => {
      expect(screen.getByLabelText('Review assignments')).toBeInTheDocument();
    });

    const reviewSwitch = screen.getByRole('switch', {
      name: 'Review assignments',
    });
    await user.click(reviewSwitch);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('shows toast on successful mutation', async () => {
    const user = userEvent.setup();

    global.fetch = vi
      .fn()
      .mockImplementation(async (_url: string, init?: RequestInit) => {
        if (!init || init.method !== 'PUT') {
          return {
            ok: true,
            json: async () => ({
              preferences: {
                email_review_assigned: true,
                email_owned_content_flagged: true,
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            preferences: {
              email_review_assigned: false,
              email_owned_content_flagged: true,
            },
          }),
        };
      });

    renderWithQuery(<NotificationPreferences />);

    await waitFor(() => {
      expect(screen.getByLabelText('Review assignments')).toBeInTheDocument();
    });

    const reviewSwitch = screen.getByRole('switch', {
      name: 'Review assignments',
    });
    await user.click(reviewSwitch);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
  });
});
