/**
 * PublicationReviewQueue — component tests.
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §7, §8 (f)/(g)/(h).
 * Plan AC: 3+ action mutation tests against the publication-review tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublicationReviewQueue } from '@/components/review/PublicationReviewQueue';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import type { ReviewQueueItem, ReviewQueueResponse } from '@/types/review';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
import { toast } from 'sonner';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ITEM_A: ReviewQueueItem = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Awaiting item A',
  suggested_title: null,
  summary: null,
  primary_domain: 'Technical',
  primary_subtopic: null,
  secondary_domain: null,
  secondary_subtopic: null,
  content_type: 'q_a_pair',
  platform: 'manual',
  author_name: null,
  source_domain: null,
  thumbnail_url: null,
  captured_date: null,
  ai_keywords: [],
  classification_confidence: 0.9,
  quality_score: null,
  priority: null,
  user_tags: [],
  metadata: null,
  content: 'Body A',
  source_url: null,
  verified_at: null,
  verified_by: null,
  freshness: null,
  governance_review_status: null,
  next_review_date: null,
  review_cadence_days: null,
  publication_status: 'in_review',
  last_reviewed_at: null,
};

function mockQueueResponse(items: ReviewQueueItem[]) {
  const response: ReviewQueueResponse = {
    items,
    total: items.length,
    verified_count: 0,
    flagged_count: 0,
    has_more: false,
  };
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => response,
  });
}

function renderQueue() {
  const { Wrapper } = createQueryWrapper();
  const user = userEvent.setup();
  const result = render(
    <Wrapper>
      <PublicationReviewQueue />
    </Wrapper>,
  );
  return { user, ...result };
}

describe('PublicationReviewQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('renders the spec-cited empty-state copy when no items (spec §7)', async () => {
    mockQueueResponse([]);
    renderQueue();

    expect(
      await screen.findByText(/no items awaiting publication\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/EP2 markdown ingests \+ bulk approval \(§5\.3\)/i),
    ).toBeInTheDocument();
  });

  it('hits GET /api/review/queue?publication_status=in_review on mount (AC f)', async () => {
    mockQueueResponse([]);
    renderQueue();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toMatch(
      /^\/api\/review\/queue\?.*publication_status=in_review/,
    );
  });

  it('renders one row per item with action buttons present', async () => {
    mockQueueResponse([ITEM_A]);
    renderQueue();

    expect(await screen.findByText('Awaiting item A')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /approve and publish this item/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /return this item to draft/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /open this item in the editor/i }),
    ).toBeInTheDocument();
  });

  it('Approve PATCH triggers row-level mutation with target=published (AC g)', async () => {
    // Initial GET response.
    mockQueueResponse([ITEM_A]);
    // PATCH response.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        previousStatus: 'in_review',
        newStatus: 'published',
        transition: 'in_review -> published',
      }),
    });
    // After PATCH success, the queue + stats keys are invalidated which
    // triggers a refetch — we provide a third mock so the refetch
    // succeeds (the row drops out of the in_review queue once published).
    mockQueueResponse([]);

    const { user } = renderQueue();
    await screen.findByText('Awaiting item A');

    await user.click(
      screen.getByRole('button', { name: /approve and publish this item/i }),
    );

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Published.'),
      );
    });

    // Verify the PATCH body shape (call index 1 = the PATCH; call 0 was
    // the initial GET; call 2 is the post-invalidation refetch).
    const patchCall = mockFetch.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    if (!patchCall) return;
    const [patchUrl, patchInit] = patchCall;
    expect(patchUrl).toBe(`/api/items/${ITEM_A.id}`);
    expect(JSON.parse(patchInit!.body as string)).toEqual({
      field: 'publication_status',
      value: 'published',
    });
  });

  it('Return to draft PATCH targets value="draft" (AC h)', async () => {
    mockQueueResponse([ITEM_A]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        previousStatus: 'in_review',
        newStatus: 'draft',
        transition: 'in_review -> draft',
      }),
    });
    // Post-invalidation refetch — same shape as Approve.
    mockQueueResponse([]);

    const { user } = renderQueue();
    await screen.findByText('Awaiting item A');

    await user.click(
      screen.getByRole('button', { name: /return this item to draft/i }),
    );

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Returned to draft.'),
      );
    });

    const patchCall = mockFetch.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    if (!patchCall) return;
    const [, patchInit] = patchCall;
    expect(JSON.parse(patchInit!.body as string)).toEqual({
      field: 'publication_status',
      value: 'draft',
    });
  });
});
