/**
 * ContentPerformanceSection — design-system contract test.
 *
 * The win-rate figure is colour-coded by performance tier (strong / medium /
 * weak) and that colour is the ONLY place the tier is encoded — there is no
 * aria/text hook for it. This file is the single intentional coupling point
 * that pins the tier -> freshness-token mapping, so a refactor that silently
 * drops the tier colouring is caught here rather than relying on a class-string
 * assertion scattered through the behaviour suite
 * (content-performance-section.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ContentPerformanceSection } from '@/components/dashboard/content-performance-section';

vi.mock('@/components/shared/domain-badge', () => ({
  DomainBadge: ({ domain }: { domain: string }) => (
    <span data-testid={`domain-badge-${domain}`}>{domain}</span>
  ),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchResponse(data: unknown, ok = true, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status,
    json: async () => data,
  });
}

describe('ContentPerformanceSection — freshness-token contract', () => {
  it('maps a strong win-rate tier (>= 70%) to the fresh freshness token', async () => {
    mockFetchResponse({
      overall: {
        win_rate: 0.8,
        total_citations: 10,
        winning_citations: 8,
        losing_citations: 2,
        pending_citations: 0,
        unique_items_cited: 6,
        unique_procurements: 4,
      },
      by_domain: [],
    });

    render(<ContentPerformanceSection />);

    await waitFor(() => {
      expect(screen.getByText('80%')).toHaveClass('text-freshness-fresh');
    });
  });
});
