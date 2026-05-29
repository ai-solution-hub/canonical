/**
 * PublicationReviewQueue — component tests.
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §7, §8 (f)/(g)/(h).
 * Plan AC: 3+ action mutation tests against the publication-review tab.
 *
 * S220 W1a: bulk multi-select coverage. Spec
 * `docs/specs/publication-approval-gate-spec.md` v1 §3 + §8 AC-bulk-4.x.
 * The full bulk action bar UI (counter, Approve / Return / Clear / Select-
 * all-on-page buttons, confirmation dialog) ships from IMPL-A1 in a sibling
 * worktree. This test file covers the queue-side wiring: bar mount/unmount
 * gated by `selectedIds.size >= 1`, prop wiring, mutation invocation with
 * `method: 'POST'`, cache invalidation, post-success cleanup, and per-row
 * action-bar coexistence with selection. Tests mock the bar + dialog as
 * inert spies so we can assert prop flow without depending on A1's
 * confirmation-dialog internals (re-validated end-to-end at W4 cherry-pick).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import type { ReviewQueueItem, ReviewQueueResponse } from '@/types/review';
import type { PublicationBulkActionBarProps } from '@/components/review/publication-bulk-action-bar';
import type { PublicationBulkResultDialogProps } from '@/components/review/publication-bulk-result-dialog';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));
import { toast } from 'sonner';

// V_W1 Finding 1 fix — mock next/navigation BEFORE importing the component
// under test, with a controllable searchParams reference per test. We use a
// mutable ref pattern (resetSearchParams() rebuilds the value) so each test
// can inject `?domain=technical&content_type=policy` etc. and exercise the
// deep-link behaviour mandated by spec §5.
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

function setSearchParams(entries: Array<[string, string]>) {
  const next = new URLSearchParams();
  for (const [key, value] of entries) {
    next.append(key, value);
  }
  mockSearchParams = next;
}

// S220 W1a — capture the latest props the queue passes to
// `<PublicationBulkActionBar>` + `<PublicationBulkResultDialog>` so we can
// assert prop wiring without IMPL-A1's internals. Each render the spy
// receives the latest props; tests inspect `lastBarProps` / `lastDialogProps`
// after waitFor() resolves.
let lastBarProps: PublicationBulkActionBarProps | null = null;
let lastDialogProps: PublicationBulkResultDialogProps | null = null;

vi.mock('@/components/review/publication-bulk-action-bar', () => ({
  PublicationBulkActionBar: (props: PublicationBulkActionBarProps) => {
    lastBarProps = props;
    return (
      <div
        data-testid="bulk-action-bar"
        data-selected-count={props.selectedIds.size}
        data-page-count={props.pageItemCount}
        data-pending={String(props.isPending)}
      />
    );
  },
}));

vi.mock('@/components/review/publication-bulk-result-dialog', () => ({
  PublicationBulkResultDialog: (props: PublicationBulkResultDialogProps) => {
    lastDialogProps = props;
    return (
      <div
        data-testid="bulk-result-dialog"
        data-open={String(props.open)}
        data-result-count={props.response?.results.length ?? 0}
      />
    );
  },
}));

// Import AFTER mocks are in place so the component picks them up.
import { PublicationReviewQueue } from '@/components/review/PublicationReviewQueue';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ITEM_A: ReviewQueueItem = {
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Awaiting item A',
  suggested_title: null,
  summary: null,
  primary_domain: 'Technical',
  primary_subtopic: 'unclassified',
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

const ITEM_B: ReviewQueueItem = {
  ...ITEM_A,
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Awaiting item B',
};

const ITEM_C: ReviewQueueItem = {
  ...ITEM_A,
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Awaiting item C',
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
  const { Wrapper, queryClient } = createQueryWrapper();
  const user = userEvent.setup();
  const result = render(
    <Wrapper>
      <PublicationReviewQueue />
    </Wrapper>,
  );
  return { user, queryClient, ...result };
}

describe('PublicationReviewQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    setSearchParams([]);
    lastBarProps = null;
    lastDialogProps = null;
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

  // V_W1 Finding 1 fix — deep-link URL params must reach the fetcher AND
  // the query key. Spec §5 third bullet:
  //   "Pasting `/review?tab=publication-review&domain=technical` lands on
  //    the tab with the domain filter pre-applied."
  describe('deep-link URL params (V_W1 Finding 1)', () => {
    it('forwards ?domain=technical to GET /api/review/queue (spec §5)', async () => {
      setSearchParams([['domain', 'technical']]);
      mockQueueResponse([]);
      renderQueue();

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
      const [url] = mockFetch.mock.calls[0];
      // Must contain BOTH publication_status=in_review (the tab discriminator)
      // AND domain=technical (the deep-linked filter).
      expect(url).toMatch(/publication_status=in_review/);
      expect(url).toMatch(/domain=technical/);
    });

    it('forwards multi-value content_type + source_file params', async () => {
      setSearchParams([
        ['content_type', 'q_a_pair'],
        ['content_type', 'capability'],
        ['source_file', 'sample.docx'],
      ]);
      mockQueueResponse([]);
      renderQueue();

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
      const [url] = mockFetch.mock.calls[0];
      // URLSearchParams roundtrip — the fetcher must append both content_type
      // values and the source_file. Order isn't load-bearing; presence is.
      const parsed = new URL(url, 'http://localhost').searchParams;
      expect(parsed.get('publication_status')).toBe('in_review');
      expect(parsed.getAll('content_type')).toEqual(['q_a_pair', 'capability']);
      expect(parsed.get('source_file')).toBe('sample.docx');
    });
  });

  // S220 W1a — bulk multi-select wiring.
  // Spec: docs/specs/publication-approval-gate-spec.md v1 §3 + §8
  // AC-bulk-4.1..4.5, 4.7, 4.9.
  describe('bulk multi-select (AC-bulk-4.x)', () => {
    it('AC-bulk-4.1 — initial render: bulk action bar NOT mounted (zero selection)', async () => {
      mockQueueResponse([ITEM_A, ITEM_B, ITEM_C]);
      renderQueue();

      // Wait until the queue renders all three items.
      await screen.findByText('Awaiting item A');
      await screen.findByText('Awaiting item B');
      await screen.findByText('Awaiting item C');

      // Bar must NOT be in the DOM at zero selection (spec §3.3 — fully
      // unmounted, NOT visually hidden). The result dialog DOES mount
      // because it's a controlled component (open=false initially).
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();

      // Per-row checkboxes: render unchecked.
      const checkboxes = screen.getAllByRole('checkbox', {
        name: /Select .* for bulk action/i,
      });
      expect(checkboxes).toHaveLength(3);
      for (const cb of checkboxes) {
        expect(cb).toHaveAttribute('aria-checked', 'false');
      }
    });

    it('AC-bulk-4.2 — clicking row 1 checkbox mounts the bar with size=1', async () => {
      mockQueueResponse([ITEM_A, ITEM_B, ITEM_C]);
      const { user } = renderQueue();
      await screen.findByText('Awaiting item A');

      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item A for bulk action/i,
        }),
      );

      // Bar should now mount.
      const bar = await screen.findByTestId('bulk-action-bar');
      expect(bar).toBeInTheDocument();
      expect(bar).toHaveAttribute('data-selected-count', '1');
      expect(bar).toHaveAttribute('data-page-count', '3');

      // Prop wiring asserts pageItemCount + selectedIds reach the bar
      // verbatim. Selection set is the source of truth; the bar derives
      // the page-id list internally via onSelectAllOnPage callback when
      // master checkbox is toggled.
      expect(lastBarProps).not.toBeNull();
      expect(lastBarProps?.pageItemCount).toBe(3);
      expect(Array.from(lastBarProps?.selectedIds ?? [])).toEqual([ITEM_A.id]);
    });

    it('AC-bulk-4.3 — three checkboxes selected: counter reads 3 of N', async () => {
      mockQueueResponse([ITEM_A, ITEM_B, ITEM_C]);
      const { user } = renderQueue();
      await screen.findByText('Awaiting item A');

      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item A for bulk action/i,
        }),
      );
      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item B for bulk action/i,
        }),
      );
      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item C for bulk action/i,
        }),
      );

      const bar = await screen.findByTestId('bulk-action-bar');
      expect(bar).toHaveAttribute('data-selected-count', '3');
      expect(bar).toHaveAttribute('data-page-count', '3');
    });

    it('AC-bulk-4.4 — onSelectAllOnPage selects every page row', async () => {
      mockQueueResponse([ITEM_A, ITEM_B, ITEM_C]);
      const { user } = renderQueue();
      await screen.findByText('Awaiting item A');

      // Click one row to mount the bar (the bar's master "Select all on
      // page" affordance is owned by IMPL-A1; here we exercise the queue's
      // `onSelectAllOnPage` callback prop directly).
      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item A for bulk action/i,
        }),
      );
      await screen.findByTestId('bulk-action-bar');

      expect(lastBarProps).not.toBeNull();
      // Invoke the prop the bar would invoke when its master checkbox is
      // toggled. The callback is the queue's responsibility, not A1's.
      act(() => {
        lastBarProps!.onSelectAllOnPage();
      });

      await waitFor(() => {
        const bar = screen.getByTestId('bulk-action-bar');
        expect(bar).toHaveAttribute('data-selected-count', '3');
      });
      expect(Array.from(lastBarProps!.selectedIds)).toEqual([
        ITEM_A.id,
        ITEM_B.id,
        ITEM_C.id,
      ]);
    });

    it('AC-bulk-4.5 — onClearSelection unmounts the bar', async () => {
      mockQueueResponse([ITEM_A, ITEM_B]);
      const { user } = renderQueue();
      await screen.findByText('Awaiting item A');

      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item A for bulk action/i,
        }),
      );
      await screen.findByTestId('bulk-action-bar');

      // Trigger clear via the prop the bar would call from its
      // "Clear selection" button.
      expect(lastBarProps).not.toBeNull();
      act(() => {
        lastBarProps!.onClearSelection();
      });

      await waitFor(() => {
        expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
      });
    });

    it('AC-bulk-4.6 (parent slice) — onApprove fires mutationFetchJson with method:"POST"', async () => {
      mockQueueResponse([ITEM_A, ITEM_B]);
      // Bulk-action POST response.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: 'approve',
          totalRequested: 2,
          successCount: 2,
          failureCount: 0,
          results: [
            {
              id: ITEM_A.id,
              status: 'success',
              previousStatus: 'in_review',
              newStatus: 'published',
            },
            {
              id: ITEM_B.id,
              status: 'success',
              previousStatus: 'in_review',
              newStatus: 'published',
            },
          ],
        }),
      });
      // Post-success refetch (queue invalidation).
      mockQueueResponse([]);

      const { user } = renderQueue();
      await screen.findByText('Awaiting item A');

      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item A for bulk action/i,
        }),
      );
      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item B for bulk action/i,
        }),
      );
      await screen.findByTestId('bulk-action-bar');

      // The bar's Approve button is owned by IMPL-A1 with a confirmation
      // dialog. Here we invoke the callback directly — the parent must
      // pass through `Set<string> -> POST /api/review/publication-bulk-action
      // body { ids: [...], action: 'approve' }, method: 'POST'`.
      // Confirmation flow is A1's territory and asserted in A1's tests.
      expect(lastBarProps).not.toBeNull();
      lastBarProps!.onApprove();

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('2 items published.');
      });

      const postCall = mockFetch.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      if (!postCall) return;
      const [postUrl, postInit] = postCall;
      expect(postUrl).toBe('/api/review/publication-bulk-action');
      // Spec §8 AC-bulk-4.6 — assert method literally contains 'POST'.
      expect(postInit?.method).toBe('POST');
      const body = JSON.parse(postInit!.body as string);
      expect(body.action).toBe('approve');
      expect(body.ids).toHaveLength(2);
      expect(new Set<string>(body.ids)).toEqual(
        new Set([ITEM_A.id, ITEM_B.id]),
      );
    });

    it('AC-bulk-4.7 — post-success: queue refetches, selection cleared, bar unmounts', async () => {
      mockQueueResponse([ITEM_A, ITEM_B]);
      // Bulk POST response — all success.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: 'approve',
          totalRequested: 2,
          successCount: 2,
          failureCount: 0,
          results: [
            {
              id: ITEM_A.id,
              status: 'success',
              previousStatus: 'in_review',
              newStatus: 'published',
            },
            {
              id: ITEM_B.id,
              status: 'success',
              previousStatus: 'in_review',
              newStatus: 'published',
            },
          ],
        }),
      });
      // Post-invalidation refetch — both rows have transitioned, queue
      // returns empty.
      mockQueueResponse([]);

      const { user } = renderQueue();
      await screen.findByText('Awaiting item A');

      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item A for bulk action/i,
        }),
      );
      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item B for bulk action/i,
        }),
      );
      await screen.findByTestId('bulk-action-bar');

      lastBarProps!.onApprove();

      // Selection cleared → bar unmounts on next render.
      await waitFor(() => {
        expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
      });

      // Refetch fired (queue invalidation). Three calls: initial GET +
      // bulk POST + post-invalidation refetch GET.
      await waitFor(() => {
        const getCalls = mockFetch.mock.calls.filter((c) => {
          const init = c[1] as RequestInit | undefined;
          return !init?.method || init.method === 'GET';
        });
        expect(getCalls.length).toBeGreaterThanOrEqual(2);
      });

      // Empty-state copy renders since the queue refetch returned no rows.
      await screen.findByText(/no items awaiting publication\./i);
    });

    it('AC-bulk-4.7 (mixed) — partial failure surfaces toast.warning + opens result dialog', async () => {
      mockQueueResponse([ITEM_A, ITEM_B]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: 'approve',
          totalRequested: 2,
          successCount: 1,
          failureCount: 1,
          results: [
            {
              id: ITEM_A.id,
              status: 'success',
              previousStatus: 'in_review',
              newStatus: 'published',
            },
            {
              id: ITEM_B.id,
              status: 'conflict',
              previousStatus: 'published',
              reason: 'Concurrent state change detected.',
            },
          ],
        }),
      });
      mockQueueResponse([ITEM_B]);

      const { user } = renderQueue();
      await screen.findByText('Awaiting item A');

      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item A for bulk action/i,
        }),
      );
      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item B for bulk action/i,
        }),
      );
      await screen.findByTestId('bulk-action-bar');

      lastBarProps!.onApprove();

      await waitFor(() => {
        expect(toast.warning).toHaveBeenCalledWith(
          expect.stringContaining('1 of 2 items published'),
          expect.objectContaining({
            action: expect.objectContaining({ label: 'View details' }),
          }),
        );
      });

      // Tigger the toast's "View details" action — opens the dialog with
      // the same response payload the toast carried. We invoke it via the
      // toast.warning mock call args.
      const warnCall = (toast.warning as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const opts = warnCall[1] as {
        action: { onClick: () => void };
      };
      act(() => {
        opts.action.onClick();
      });

      await waitFor(() => {
        expect(lastDialogProps?.open).toBe(true);
        expect(lastDialogProps?.response?.successCount).toBe(1);
        expect(lastDialogProps?.response?.failureCount).toBe(1);
      });
      // itemTitleLookup wires titles for items currently on the page so
      // the dialog can render human-readable per-item failures. After the
      // refetch, ITEM_A has transitioned to published and dropped out of
      // the in_review queue — so only ITEM_B (the failed row) remains in
      // the lookup. The dialog impl (IMPL-A1) handles the missing-title
      // case (it can fall back to the response's `id` field for any row
      // that's already left the page after refetch).
      expect(lastDialogProps?.itemTitleLookup.get(ITEM_B.id)).toBe(
        'Awaiting item B',
      );
    });

    it('AC-bulk-4.7 (all-failed) — zero successes surfaces toast.error + opens dialog', async () => {
      mockQueueResponse([ITEM_A]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: 'approve',
          totalRequested: 1,
          successCount: 0,
          failureCount: 1,
          results: [
            {
              id: ITEM_A.id,
              status: 'conflict',
              previousStatus: 'published',
              reason: 'Concurrent state change detected.',
            },
          ],
        }),
      });
      mockQueueResponse([ITEM_A]);

      const { user } = renderQueue();
      await screen.findByText('Awaiting item A');

      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item A for bulk action/i,
        }),
      );
      await screen.findByTestId('bulk-action-bar');

      lastBarProps!.onApprove();

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Could not process any of the 1 selected items.',
        );
      });

      // All-failed automatically opens the dialog (no toast action needed).
      await waitFor(() => {
        expect(lastDialogProps?.open).toBe(true);
      });
    });

    it('AC-bulk-4.9 — per-row Approve button still works while selection is non-empty', async () => {
      mockQueueResponse([ITEM_A, ITEM_B]);
      // Per-row PATCH response.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          previousStatus: 'in_review',
          newStatus: 'published',
          transition: 'in_review -> published',
        }),
      });
      mockQueueResponse([ITEM_B]);

      const { user } = renderQueue();
      await screen.findByText('Awaiting item A');

      // Pre-select row A.
      await user.click(
        screen.getByRole('checkbox', {
          name: /Select Awaiting item A for bulk action/i,
        }),
      );
      await screen.findByTestId('bulk-action-bar');
      const beforeSelectedCount = screen
        .getByTestId('bulk-action-bar')
        .getAttribute('data-selected-count');
      expect(beforeSelectedCount).toBe('1');

      // Click row B's per-row Approve button — should fire PATCH against
      // ITEM_B.id and NOT alter the selection set (still includes ITEM_A).
      const approveButtons = screen.getAllByRole('button', {
        name: /approve and publish this item/i,
      });
      // approveButtons[0] = ITEM_A's row, approveButtons[1] = ITEM_B's row.
      await user.click(approveButtons[1]);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith(
          expect.stringContaining('Published.'),
        );
      });

      const patchCall = mockFetch.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const [patchUrl] = patchCall!;
      expect(patchUrl).toBe(`/api/items/${ITEM_B.id}`);

      // Selection state unchanged — bar still shows 1 selected (A still
      // ticked). Note: queue refetches after PATCH success which may
      // re-render the bar; assert against the latest props rather than
      // querying DOM (which can race the refetch).
      await waitFor(() => {
        expect(lastBarProps?.selectedIds.has(ITEM_A.id)).toBe(true);
      });
    });
  });
});
