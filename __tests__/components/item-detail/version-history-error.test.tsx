/**
 * VersionHistory — error-state tests
 *
 * Covers the two remediated silent-failure sites:
 *   - version-history.tsx loadList: fetch error → error UI + telemetry
 *   - version-history.tsx loadDetail: fetch error → toast + telemetry
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockCaptureClientException, mockToastError, mockToastSuccess } =
  vi.hoisted(() => ({
    mockCaptureClientException: vi.fn(),
    mockToastError: vi.fn(),
    mockToastSuccess: vi.fn(),
  }));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: vi.fn().mockReturnValue(new Map()),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: vi.fn().mockReturnValue({ canEdit: false }),
}));

vi.mock('sonner', () => ({
  toast: { error: mockToastError, success: mockToastSuccess },
}));

vi.mock('@/lib/client-telemetry', () => ({
  captureClientException: mockCaptureClientException,
}));

import { VersionHistory } from '@/components/item-detail/version-history';

const ITEM_ID = '22222222-2222-4222-8222-222222222222';

const SAMPLE_VERSION = {
  id: 'version-1',
  content_item_id: ITEM_ID,
  version: 2,
  title: 'Sample item',
  change_summary: 'Updated detail',
  change_reason: null,
  change_type: 'edit',
  created_by: null,
  created_at: '2026-04-01T09:00:00Z',
};

describe('VersionHistory — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows error state and reports telemetry when the list fails to load', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <VersionHistory
        itemId={ITEM_ID}
        currentContent="current body"
        currentTitle="Sample item"
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: /version history/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load version history/i),
      ).toBeInTheDocument();
    });

    expect(mockCaptureClientException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        scope: 'item-detail.version-history.loadList',
        extras: expect.objectContaining({ itemId: ITEM_ID }),
      }),
    );
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to load version history',
    );
  });

  it('retry button re-runs the list fetch', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ versions: [SAMPLE_VERSION], total: 1 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <VersionHistory
        itemId={ITEM_ID}
        currentContent="current body"
        currentTitle="Sample item"
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: /version history/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load version history/i),
      ).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('Updated detail')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports telemetry when detail fetch fails after clicking Diff', async () => {
    const fetchMock = vi
      .fn()
      // List loads successfully
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ versions: [SAMPLE_VERSION], total: 1 }),
      })
      // Detail rejects
      .mockRejectedValueOnce(new Error('detail down'));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <VersionHistory
        itemId={ITEM_ID}
        currentContent="current body"
        currentTitle="Sample item"
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: /version history/i }),
    );

    await waitFor(() => {
      expect(screen.getByText('Updated detail')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /diff/i }));

    await waitFor(() => {
      expect(mockCaptureClientException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          scope: 'item-detail.version-history.loadDetail',
          extras: expect.objectContaining({
            itemId: ITEM_ID,
            versionId: 'version-1',
          }),
        }),
      );
    });
    expect(mockToastError).toHaveBeenCalledWith('Failed to load version detail');
  });
});
