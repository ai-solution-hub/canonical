/**
 * PublicationReviewActionBar — component tests.
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §7, §8 (g)/(h)/(i)/(j).
 * Plan AC: ReviewTabs URL-state covered separately; this file covers the
 * three-button action set + 403 toast surfacing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublicationReviewActionBar } from '@/components/review/publication-review-action-bar';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// Mock sonner toast so we can assert error-path surfacing without a real
// toast container in the test DOM.
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// We import the mocked module to read the spies inside tests.
import { toast } from 'sonner';

// Mock global fetch so we control PATCH responses.
const mockFetch = vi.fn();
global.fetch = mockFetch;

const ITEM_ID = '11111111-1111-4111-8111-111111111111';

function renderActionBar() {
  const { Wrapper } = createQueryWrapper();
  const user = userEvent.setup();
  const result = render(
    <Wrapper>
      <PublicationReviewActionBar itemId={ITEM_ID} />
    </Wrapper>,
  );
  return { user, ...result };
}

describe('PublicationReviewActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('renders the three actions with accessible labels (spec §7)', () => {
    renderActionBar();

    expect(
      screen.getByRole('button', { name: /approve and publish this item/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /return this item to draft/i }),
    ).toBeInTheDocument();
    // "Open in editor" is rendered as a Link via Button asChild — it is a
    // link, not a button (so middle-click works per AC (i)).
    const editorLink = screen.getByRole('link', {
      name: /open this item in the editor/i,
    });
    expect(editorLink).toBeInTheDocument();
    expect(editorLink).toHaveAttribute('href', `/item/${ITEM_ID}`);
  });

  it('Approve & publish triggers POST /api/review/publication-bulk-action with action="approve" (AC g, ID-131 B3-ext re-point)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        action: 'approve',
        totalRequested: 1,
        successCount: 1,
        failureCount: 0,
        results: [
          {
            id: ITEM_ID,
            status: 'success',
            previousStatus: 'in_review',
            newStatus: 'published',
          },
        ],
      }),
    });

    const { user } = renderActionBar();
    const approveBtn = screen.getByRole('button', {
      name: /approve and publish this item/i,
    });
    await user.click(approveBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/review/publication-bulk-action');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      ids: [ITEM_ID],
      action: 'approve',
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Published.'),
      );
    });
  });

  it('Return to draft triggers POST with action="return_to_draft" (AC h)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        action: 'return_to_draft',
        totalRequested: 1,
        successCount: 1,
        failureCount: 0,
        results: [
          {
            id: ITEM_ID,
            status: 'success',
            previousStatus: 'in_review',
            newStatus: 'draft',
          },
        ],
      }),
    });

    const { user } = renderActionBar();
    const returnBtn = screen.getByRole('button', {
      name: /return this item to draft/i,
    });
    await user.click(returnBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      ids: [ITEM_ID],
      action: 'return_to_draft',
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Returned to draft.'),
      );
    });
  });

  it('surfaces a per-item "forbidden" result via toast WITHOUT hiding buttons (AC j)', async () => {
    // The bulk-action route ALWAYS resolves HTTP 200 — per-item role-gate
    // failures are folded into `results[]`, not thrown as an HTTP 403
    // (ID-131 B3-ext re-point; see route.ts `computeAllowedTransitions`
    // gate + doc comment on the component's mutation).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        action: 'approve',
        totalRequested: 1,
        successCount: 0,
        failureCount: 1,
        results: [
          {
            id: ITEM_ID,
            status: 'forbidden',
            previousStatus: 'in_review',
            reason:
              "Role 'editor' cannot transition 'in_review' -> 'published'",
          },
        ],
      }),
    });

    const { user } = renderActionBar();
    const approveBtn = screen.getByRole('button', {
      name: /approve and publish this item/i,
    });
    await user.click(approveBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('admin-only'),
      );
    });
    // The buttons remain in the DOM — no client-side hide on a forbidden result.
    expect(approveBtn).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /return this item to draft/i }),
    ).toBeInTheDocument();
  });

  it('does NOT bind Enter to Approve & publish (S215 OQ2 ratified)', async () => {
    // The action bar must not submit on Enter — high-stakes action per
    // spec §12 OQ2 (Liam confirmed in S215 kickoff: do not bind).
    const { user } = renderActionBar();
    // Focus the document body and press Enter — no PATCH should fire.
    await user.keyboard('{Enter}');
    expect(mockFetch).not.toHaveBeenCalled();

    // Even when an unrelated focused element receives Enter, the action
    // bar should not intercept. We focus the editor link (a non-button
    // anchor) to verify there's no global Enter handler.
    const editorLink = screen.getByRole('link', {
      name: /open this item in the editor/i,
    });
    editorLink.focus();
    await user.keyboard('{Enter}');
    // The link's own activation may navigate (handled by jsdom as no-op);
    // we only assert no PATCH was triggered by the action bar.
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
