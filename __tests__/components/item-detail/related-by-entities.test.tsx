/**
 * RelatedByEntities — error-state tests
 *
 * Three possible error branches (own entities, shared mentions, details)
 * consolidate into a single error UI with a retry button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockCaptureClientException, mockFrom } = vi.hoisted(() => ({
  mockCaptureClientException: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}));

vi.mock('@/lib/client-telemetry', () => ({
  captureClientException: mockCaptureClientException,
}));

vi.mock('@/components/shared/domain-badge', () => ({
  DomainBadge: ({ domain }: { domain: string }) => <span>{domain}</span>,
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { RelatedByEntities } from '@/components/item-detail/related-by-entities';

/**
 * Build a supabase chain that returns `result` for the nth call.
 * Each call to `.from()` moves the cursor forward.
 */
function chainReturning(results: Array<{ data: unknown; error: unknown }>) {
  let i = 0;
  return vi.fn(() => {
    const r = results[i++] ?? { data: [], error: null };
    return {
      select: () => ({
        eq: () => Promise.resolve(r),
        in: () => ({
          neq: () => Promise.resolve(r),
          or: () => Promise.resolve(r),
        }),
      }),
    };
  });
}

describe('RelatedByEntities — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders error state and reports telemetry when own-entities query fails', async () => {
    mockFrom.mockImplementation(
      chainReturning([{ data: null, error: new Error('ent failed') }]),
    );

    render(<RelatedByEntities contentItemId="item-1" />);

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load related items/i),
      ).toBeInTheDocument();
    });

    expect(mockCaptureClientException).toHaveBeenCalledTimes(1);
    expect(mockCaptureClientException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        scope: 'item-detail.related-by-entities.fetchItemEntities',
        extras: expect.objectContaining({ contentItemId: 'item-1' }),
      }),
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('retry button re-runs the fetch', async () => {
    // First round: error. Second round: success with no results.
    const round1 = chainReturning([
      { data: null, error: new Error('ent failed') },
    ]);
    const round2 = chainReturning([
      { data: [{ canonical_name: 'ACME' }], error: null },
      { data: [], error: null }, // no shared mentions → bails out, items=[]
    ]);

    let callCount = 0;
    mockFrom.mockImplementation((...args: unknown[]) => {
      const fn = callCount === 0 ? round1 : round2;
      // first round hits from() once, second round hits it twice
      const res = fn(...(args as []));
      if (callCount === 0 || callCount === 2) callCount++;
      else callCount++;
      return res;
    });

    render(<RelatedByEntities contentItemId="item-1" />);

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load related items/i),
      ).toBeInTheDocument();
    });

    const before = mockFrom.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(mockFrom.mock.calls.length).toBeGreaterThan(before);
    });
  });
});
