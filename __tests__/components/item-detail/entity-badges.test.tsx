/**
 * EntityBadges — error-state tests
 *
 * Verifies that when the underlying Supabase query fails:
 *   1. captureClientException is called with the expected scope
 *   2. An error UI is rendered with a Retry button
 *   3. Clicking Retry re-runs the fetch
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockOrder, mockCaptureClientException } = vi.hoisted(() => ({
  mockOrder: vi.fn(),
  mockCaptureClientException: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: mockOrder,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/client-telemetry', () => ({
  captureClientException: mockCaptureClientException,
}));

import { EntityBadges } from '@/components/item-detail/entity-badges';

describe('EntityBadges — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows error state with retry button on fetch failure and reports telemetry', async () => {
    mockOrder.mockResolvedValueOnce({
      data: null,
      error: new Error('query failed'),
    });

    render(<EntityBadges contentItemId="item-xyz" />);

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load entities/i),
      ).toBeInTheDocument();
    });

    expect(mockCaptureClientException).toHaveBeenCalledTimes(1);
    expect(mockCaptureClientException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        scope: 'item-detail.entity-badges.fetchMentions',
        extras: expect.objectContaining({ contentItemId: 'item-xyz' }),
      }),
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('retries fetch when the retry button is clicked', async () => {
    mockOrder
      .mockResolvedValueOnce({
        data: null,
        error: new Error('query failed'),
      })
      .mockResolvedValueOnce({ data: [], error: null });

    render(<EntityBadges contentItemId="item-xyz" />);

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load entities/i),
      ).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(mockOrder).toHaveBeenCalledTimes(2);
    });
    // After successful retry (empty result), empty state is shown
    await waitFor(() => {
      expect(
        screen.getByText(/no entities detected/i),
      ).toBeInTheDocument();
    });
  });
});
