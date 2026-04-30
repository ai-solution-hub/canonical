/**
 * ReviewTabs — URL-state + render tests.
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §3, §5, §8 (a)-(e).
 * Plan AC: 3+ URL-state tests covering the round-trip + invalid-fallback
 * behaviour mirrored from `app/coverage/coverage-tabs.tsx`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// Mock next/navigation BEFORE importing the component under test, with
// a controllable searchParams getter so each test can pin ?tab=…
const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  usePathname: () => '/review',
}));

// Mock heavy children — we only assert on the tabs shell behaviour.
vi.mock('@/app/review/review-content', () => ({
  ReviewContent: ({
    initialStatus,
    hideStatusPills,
  }: {
    initialStatus?: string;
    hideStatusPills?: boolean;
  }) => (
    <div
      data-testid="review-content-mock"
      data-initial-status={initialStatus ?? 'undef'}
      data-hide-status-pills={String(hideStatusPills ?? false)}
    >
      ReviewContent mock
    </div>
  ),
}));

vi.mock('@/components/review/PublicationReviewQueue', () => ({
  PublicationReviewQueue: () => (
    <div data-testid="publication-review-queue-mock">
      PublicationReviewQueue mock
    </div>
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Now import after mocks are set up.
import { ReviewTabs } from '@/components/review/review-tabs';

function renderTabs() {
  const { Wrapper } = createQueryWrapper();
  const user = userEvent.setup();
  // Default stats response so the count badges resolve without errors.
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      total: 100,
      verified: 30,
      flagged: 5,
      unverified: 60,
      draft: 5,
      overdue: 0,
      awaiting_publication: 7,
      by_domain: {},
      by_content_type: {},
      by_source_file: {},
      by_source_document: {},
    }),
  });
  const result = render(
    <Wrapper>
      <ReviewTabs />
    </Wrapper>,
  );
  return { user, ...result };
}

function setSearchParam(key: string, value: string | null) {
  // Reset and set a single param. Vitest mocks share the
  // mockSearchParams instance across tests in this file so we must
  // explicitly clear keys that might linger.
  for (const k of Array.from(mockSearchParams.keys())) {
    mockSearchParams.delete(k);
  }
  if (value !== null) {
    mockSearchParams.set(key, value);
  }
}

describe('ReviewTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplace.mockReset();
    setSearchParam('tab', null);
  });

  describe('initial-tab resolution from ?tab=', () => {
    it('defaults to verified-review when ?tab= is absent (AC c)', () => {
      setSearchParam('tab', null);
      renderTabs();

      const verifiedReviewTab = screen.getByRole('tab', {
        name: /verified content review/i,
      });
      expect(verifiedReviewTab).toHaveAttribute('aria-selected', 'true');
    });

    it('lands on publication-review when ?tab=publication-review (AC c)', () => {
      setSearchParam('tab', 'publication-review');
      renderTabs();

      const publicationTab = screen.getByRole('tab', {
        name: /awaiting publication/i,
      });
      expect(publicationTab).toHaveAttribute('aria-selected', 'true');
    });

    it('lands on verified-audit when ?tab=verified-audit', () => {
      setSearchParam('tab', 'verified-audit');
      renderTabs();

      const auditTab = screen.getByRole('tab', { name: /verified \(audit\)/i });
      expect(auditTab).toHaveAttribute('aria-selected', 'true');
      // ReviewContent should mount with initialStatus='verified' so the
      // bulk re-verify capability is preserved (spec §3 row 4).
      const reviewContentMock = screen.getByTestId('review-content-mock');
      expect(reviewContentMock).toHaveAttribute(
        'data-initial-status',
        'verified',
      );
    });

    it('falls back to verified-review when ?tab=garbage (AC c)', () => {
      setSearchParam('tab', 'not-a-real-tab');
      renderTabs();

      const verifiedReviewTab = screen.getByRole('tab', {
        name: /verified content review/i,
      });
      expect(verifiedReviewTab).toHaveAttribute('aria-selected', 'true');
    });

    // V_W1 Finding 4 fix — pasting `/review?tab=verified-review` (the
    // default tab) leaves the param in the URL on initial mount. The fix
    // adds a one-shot effect that calls `router.replace(pathname)` when
    // `tabParam === DEFAULT_TAB`, stripping the redundant marker.
    it('strips ?tab=verified-review from URL on initial mount when default tab (V_W1 Finding 4)', () => {
      setSearchParam('tab', 'verified-review');
      renderTabs();

      // The mount effect MUST have called router.replace once with the
      // path-only (no ?tab=) URL. Other tabs do NOT trigger this effect.
      expect(mockReplace).toHaveBeenCalledTimes(1);
      const [path, opts] = mockReplace.mock.calls[0];
      expect(path).toBe('/review');
      expect(opts).toEqual({ scroll: false });
    });

    it('does NOT strip non-default ?tab= on initial mount', () => {
      setSearchParam('tab', 'publication-review');
      renderTabs();

      // The mount effect is a no-op for non-default tabs.
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('tab-change persistence (AC d)', () => {
    it('calls router.replace with ?tab=publication-review on click', async () => {
      setSearchParam('tab', null);
      const { user } = renderTabs();

      const publicationTab = screen.getByRole('tab', {
        name: /awaiting publication/i,
      });
      await user.click(publicationTab);

      expect(mockReplace).toHaveBeenCalledTimes(1);
      const [path, opts] = mockReplace.mock.calls[0];
      expect(path).toBe('/review?tab=publication-review');
      expect(opts).toEqual({ scroll: false });
    });

    it('DELETEs ?tab= when clicking the default tab (matches coverage-tabs semantics)', async () => {
      setSearchParam('tab', 'drafts');
      const { user } = renderTabs();

      const verifiedReviewTab = screen.getByRole('tab', {
        name: /verified content review/i,
      });
      await user.click(verifiedReviewTab);

      expect(mockReplace).toHaveBeenCalledTimes(1);
      const [path] = mockReplace.mock.calls[0];
      // Default tab → no ?tab= in URL (spec §5).
      expect(path).toBe('/review');
    });

    it('strips legacy ?status= alongside ?tab= rewrite', async () => {
      // Set both ?status= (legacy) and ?tab= (new) to exercise the
      // strip semantics in handleTabChange.
      mockSearchParams.set('tab', 'drafts');
      mockSearchParams.set('status', 'draft');
      const { user } = renderTabs();

      const allTab = screen.getByRole('tab', { name: /all/i });
      await user.click(allTab);

      const [path] = mockReplace.mock.calls[0];
      // status=… is gone; tab=all is present.
      expect(path).toBe('/review?tab=all');
    });
  });

  describe('count badges (AC b)', () => {
    it('renders the awaiting_publication count from stats on the publication-review tab', async () => {
      setSearchParam('tab', null);
      renderTabs();

      // Wait for the stats fetch to resolve.
      const publicationTab = await screen.findByRole('tab', {
        name: /awaiting publication.*7 items/i,
      });
      expect(publicationTab).toBeInTheDocument();
    });
  });
});
