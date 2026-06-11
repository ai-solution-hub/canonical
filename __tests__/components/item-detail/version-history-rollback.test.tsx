/**
 * VersionHistory — rollback mutation tests (ID-106.1)
 *
 * Verifies that the TanStack Query useMutation rollback leg:
 *   - calls invalidateQueries with the correct item-history key on success
 *   - fires toast.success on success
 *   - fires toast.error on failure (preserving the existing error contract)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { queryKeys } from '@/lib/query/query-keys';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

const { mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: vi.fn().mockReturnValue(new Map()),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: vi.fn().mockReturnValue({ canEdit: true }),
}));

vi.mock('sonner', () => ({
  toast: { error: mockToastError, success: mockToastSuccess },
}));

vi.mock('@/lib/client-telemetry', () => ({
  captureClientException: vi.fn(),
}));

import { VersionHistory } from '@/components/item-detail/version-history';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = 'version-abc';

const SAMPLE_VERSION = {
  id: VERSION_ID,
  content_item_id: ITEM_ID,
  version: 2,
  change_summary: 'Some change',
  change_reason: null,
  change_type: 'edit',
  created_by: null,
  created_at: '2026-05-01T09:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VersionHistory — rollback mutation (ID-106.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invalidates item-history keys and fires toast.success on rollback success', async () => {
    const fetchMock = vi
      .fn()
      // List fetch succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ versions: [SAMPLE_VERSION], total: 1 }),
      })
      // Rollback POST succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { queryClient, Wrapper } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <VersionHistory
        itemId={ITEM_ID}
        currentContent="current body"
        currentTitle="Sample item"
      />,
      { wrapper: Wrapper },
    );

    // Open history panel
    await userEvent.click(
      screen.getByRole('button', { name: /version history/i }),
    );

    // Wait for list to load
    await waitFor(() => {
      expect(screen.getByText('Some change')).toBeInTheDocument();
    });

    // Click Restore button
    const restoreBtn = screen.getByRole('button', { name: /restore/i });
    await userEvent.click(restoreBtn);

    // Verify invalidateQueries was called with item-history all key
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: queryKeys.itemHistory.all(ITEM_ID),
        }),
      );
    });

    // Verify success toast fired
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Content rolled back successfully',
    );
  });

  it('fires toast.error with the server error message on rollback failure', async () => {
    const fetchMock = vi
      .fn()
      // List fetch succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ versions: [SAMPLE_VERSION], total: 1 }),
      })
      // Rollback POST fails with a JSON error body
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Cannot rollback to this version' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { Wrapper } = createQueryWrapper();

    render(
      <VersionHistory
        itemId={ITEM_ID}
        currentContent="current body"
        currentTitle="Sample item"
      />,
      { wrapper: Wrapper },
    );

    await userEvent.click(
      screen.getByRole('button', { name: /version history/i }),
    );

    await waitFor(() => {
      expect(screen.getByText('Some change')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /restore/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'Cannot rollback to this version',
      );
    });
  });
});
