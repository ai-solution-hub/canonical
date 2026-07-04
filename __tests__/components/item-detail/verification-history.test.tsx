/**
 * VerificationHistory — error-state tests
 *
 * Covers the two remediated silent-failure branches (both inside a single
 * useEffect): supabase-returned error and rejected promise catch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockCaptureClientException, mockOrder } = vi.hoisted(() => ({
  mockCaptureClientException: vi.fn(),
  mockOrder: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: mockOrder,
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/client-telemetry', () => ({
  captureClientException: mockCaptureClientException,
}));

vi.mock('@/lib/supabase/telemetry', () => ({
  logBestEffortWarn: vi.fn(),
}));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: vi.fn().mockReturnValue(new Map()),
}));

vi.mock('@/components/shared/verification-badge', () => ({
  formatRelativeTime: () => 'just now',
}));

import { VerificationHistory } from '@/components/item-detail/verification-history';

describe('VerificationHistory — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders error UI and reports telemetry when supabase returns an error', async () => {
    mockOrder.mockResolvedValueOnce({
      data: null,
      error: new Error('db fail'),
    });

    render(<VerificationHistory sourceDocumentId="item-v1" />);

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load verification history/i),
      ).toBeInTheDocument();
    });

    expect(mockCaptureClientException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        scope: 'item-detail.verification-history.loadError',
        extras: expect.objectContaining({ sourceDocumentId: 'item-v1' }),
      }),
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('reports telemetry with loadCatch scope when the promise rejects', async () => {
    mockOrder.mockRejectedValueOnce(new Error('boom'));

    render(<VerificationHistory sourceDocumentId="item-v1" />);

    await waitFor(() => {
      expect(mockCaptureClientException).toHaveBeenCalled();
    });

    expect(mockCaptureClientException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        scope: 'item-detail.verification-history.loadCatch',
        extras: expect.objectContaining({ sourceDocumentId: 'item-v1' }),
      }),
    );
    expect(
      screen.getByText(/couldn't load verification history/i),
    ).toBeInTheDocument();
  });

  it('retry button re-runs the fetch', async () => {
    mockOrder
      .mockResolvedValueOnce({
        data: null,
        error: new Error('db fail'),
      })
      .mockResolvedValueOnce({ data: [], error: null });

    render(<VerificationHistory sourceDocumentId="item-v1" />);

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load verification history/i),
      ).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/no verification history for this item/i),
      ).toBeInTheDocument();
    });
    expect(mockOrder).toHaveBeenCalledTimes(2);
  });
});
