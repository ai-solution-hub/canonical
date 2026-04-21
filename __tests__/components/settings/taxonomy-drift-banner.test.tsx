/**
 * TaxonomyDriftBanner Component Tests
 *
 * Tests drift-detection banner rendering, dismiss behaviour,
 * regenerate mutation, error handling, and accessibility.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
  cleanup,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaxonomyDriftBanner } from '@/components/settings/taxonomy-drift-banner';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({
  toast: mockToast,
}));

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

const DRIFT_RESPONSE = {
  in_sync: false,
  last_sync_at: '2026-04-20T12:00:00Z',
  current_hash: 'abc123',
  synced_hash: 'def456',
};

const IN_SYNC_RESPONSE = {
  in_sync: true,
  last_sync_at: '2026-04-20T12:00:00Z',
  current_hash: 'abc123',
  synced_hash: 'abc123',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock;
  mockToast.success.mockClear();
  mockToast.error.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockStatusResponse(data: typeof DRIFT_RESPONSE | typeof IN_SYNC_RESPONSE) {
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/admin/taxonomy-sync/status') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

function mockStatusError(status = 500) {
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/admin/taxonomy-sync/status') {
      return Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve({ error: 'Server error' }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaxonomyDriftBanner', () => {
  it('renders warning banner when in_sync is false', async () => {
    mockStatusResponse(DRIFT_RESPONSE);
    const { Wrapper } = createQueryWrapper();

    render(<TaxonomyDriftBanner />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByText('Taxonomy has changed since the last sync'),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Regenerate now/)).toBeInTheDocument();
  });

  it('does not render when in_sync is true', async () => {
    mockStatusResponse(IN_SYNC_RESPONSE);
    const { Wrapper } = createQueryWrapper();

    render(<TaxonomyDriftBanner />, { wrapper: Wrapper });

    // Wait for query to settle (loading → data arrives)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/taxonomy-sync/status',
        undefined,
      );
    });

    // Banner should not appear
    expect(
      screen.queryByText('Taxonomy has changed since the last sync'),
    ).not.toBeInTheDocument();
  });

  it('hides banner after clicking Dismiss', async () => {
    mockStatusResponse(DRIFT_RESPONSE);
    const { Wrapper } = createQueryWrapper();

    render(<TaxonomyDriftBanner />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByText('Taxonomy has changed since the last sync'),
      ).toBeInTheDocument();
    });

    const dismissButton = screen.getByRole('button', {
      name: /dismiss taxonomy drift warning/i,
    });

    await act(async () => {
      fireEvent.click(dismissButton);
    });

    expect(
      screen.queryByText('Taxonomy has changed since the last sync'),
    ).not.toBeInTheDocument();
  });

  it('fires POST and shows success toast on Regenerate now', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/admin/taxonomy-sync/status') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(DRIFT_RESPONSE),
        });
      }
      if (url === '/api/admin/taxonomy-sync' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ dispatched: true, run_id: 'run-1' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { Wrapper } = createQueryWrapper();
    render(<TaxonomyDriftBanner />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/Regenerate now/)).toBeInTheDocument();
    });

    const regenerateButton = screen.getByRole('button', {
      name: /regenerate taxonomy sync files/i,
    });

    await act(async () => {
      fireEvent.click(regenerateButton);
    });

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.stringContaining('Sync dispatched'),
      );
    });
  });

  it('shows error toast on POST failure', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/admin/taxonomy-sync/status') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(DRIFT_RESPONSE),
        });
      }
      if (url === '/api/admin/taxonomy-sync' && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 502,
          json: () =>
            Promise.resolve({ error: 'GitHub token is invalid or expired' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { Wrapper } = createQueryWrapper();
    render(<TaxonomyDriftBanner />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/Regenerate now/)).toBeInTheDocument();
    });

    const regenerateButton = screen.getByRole('button', {
      name: /regenerate taxonomy sync files/i,
    });

    await act(async () => {
      fireEvent.click(regenerateButton);
    });

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringContaining('GitHub token is invalid or expired'),
      );
    });
  });

  it('re-shows banner on remount if drift persists (dismiss is session-scoped)', async () => {
    mockStatusResponse(DRIFT_RESPONSE);
    const { Wrapper, queryClient } = createQueryWrapper();

    const { unmount } = render(<TaxonomyDriftBanner />, {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(
        screen.getByText('Taxonomy has changed since the last sync'),
      ).toBeInTheDocument();
    });

    // Dismiss
    const dismissButton = screen.getByRole('button', {
      name: /dismiss taxonomy drift warning/i,
    });
    await act(async () => {
      fireEvent.click(dismissButton);
    });

    expect(
      screen.queryByText('Taxonomy has changed since the last sync'),
    ).not.toBeInTheDocument();

    // Unmount and remount — clear query cache to simulate fresh mount
    unmount();
    queryClient.clear();

    render(<TaxonomyDriftBanner />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByText('Taxonomy has changed since the last sync'),
      ).toBeInTheDocument();
    });
  });

  it('does not render when status fetch fails', async () => {
    mockStatusError(500);
    const { Wrapper } = createQueryWrapper();

    render(<TaxonomyDriftBanner />, { wrapper: Wrapper });

    // Wait for the query to fail (retry: 1, so two attempts)
    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );

    // Banner should not appear on error
    expect(
      screen.queryByText('Taxonomy has changed since the last sync'),
    ).not.toBeInTheDocument();
  });

  it('has role="status" and aria-live="polite" on the banner', async () => {
    mockStatusResponse(DRIFT_RESPONSE);
    const { Wrapper } = createQueryWrapper();

    render(<TaxonomyDriftBanner />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        screen.getByText('Taxonomy has changed since the last sync'),
      ).toBeInTheDocument();
    });

    const banner = screen.getByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('buttons are keyboard accessible', async () => {
    mockStatusResponse(DRIFT_RESPONSE);
    const { Wrapper } = createQueryWrapper();
    const user = userEvent.setup();

    render(<TaxonomyDriftBanner />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/Regenerate now/)).toBeInTheDocument();
    });

    const regenerateButton = screen.getByRole('button', {
      name: /regenerate taxonomy sync files/i,
    });
    const dismissButton = screen.getByRole('button', {
      name: /dismiss taxonomy drift warning/i,
    });

    // Tab to regenerate button
    await user.tab();
    // Keep tabbing until we reach one of the target buttons
    let maxTabs = 5;
    while (
      document.activeElement !== regenerateButton &&
      document.activeElement !== dismissButton &&
      maxTabs > 0
    ) {
      await user.tab();
      maxTabs--;
    }

    expect(
      document.activeElement === regenerateButton ||
        document.activeElement === dismissButton,
    ).toBe(true);
  });
});
