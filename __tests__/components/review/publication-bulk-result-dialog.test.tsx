/**
 * PublicationBulkResultDialog — component tests.
 *
 * Spec: docs/specs/publication-approval-gate-spec.md §7.7,
 * §8 AC-bulk-4.x. Covers:
 *  - `response === null` renders nothing inside the dialog
 *  - Title shows "X of N items could not be published" when failureCount > 0
 *  - Per-item failure list shows item title from lookup
 *  - Falls back to "<UUID> (item no longer in queue)" when title missing
 *  - onOpenChange(false) closes dialog
 *  - All-success response shows success summary (failureCount=0)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PublicationBulkResultDialog } from '@/components/review/publication-bulk-result-dialog';
import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import type { PublicationBulkActionResponse } from '@/lib/query/fetchers';

function uuid(n: number): string {
  const hex = n.toString(16).padStart(2, '0');
  return `${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}-${hex}${hex}${hex}${hex}-4${hex}${hex}${hex}-8${hex}${hex}${hex}-${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}`;
}

const ID_1 = uuid(1);
const ID_2 = uuid(2);
const ID_3 = uuid(3);
const ID_NOT_IN_LOOKUP = uuid(99);

function makeMixedResponse(): PublicationBulkActionResponse {
  return {
    action: 'approve',
    totalRequested: 5,
    successCount: 3,
    failureCount: 2,
    results: [
      {
        id: ID_1,
        status: 'success',
        previousStatus: 'in_review',
        newStatus: 'published',
      },
      {
        id: ID_2,
        status: 'conflict',
        previousStatus: 'published',
        reason: 'Concurrent state change detected.',
      },
      {
        id: ID_3,
        status: 'forbidden',
        previousStatus: 'archived',
        reason: "Role 'editor' cannot transition 'archived' -> 'published'",
      },
    ],
  };
}

function makeAllSuccessResponse(): PublicationBulkActionResponse {
  return {
    action: 'approve',
    totalRequested: 4,
    successCount: 4,
    failureCount: 0,
    results: [
      {
        id: ID_1,
        status: 'success',
        previousStatus: 'in_review',
        newStatus: 'published',
      },
      {
        id: ID_2,
        status: 'success',
        previousStatus: 'in_review',
        newStatus: 'published',
      },
    ],
  };
}

function makeAllFailedResponse(): PublicationBulkActionResponse {
  return {
    action: 'approve',
    totalRequested: 2,
    successCount: 0,
    failureCount: 2,
    results: [
      {
        id: ID_1,
        status: 'error',
        error: 'PG connection failure',
      },
      {
        id: ID_NOT_IN_LOOKUP,
        status: 'not_found',
      },
    ],
  };
}

describe('PublicationBulkResultDialog', () => {
  beforeEach(() => {
    installRadixPointerShims();
    vi.clearAllMocks();
  });

  it('renders nothing when response === null (§7.7)', () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <PublicationBulkResultDialog
        open
        onOpenChange={onOpenChange}
        response={null}
        itemTitleLookup={new Map()}
      />,
    );
    // Component returns null when response === null, so neither the
    // dialog role nor any title text should appear in the document.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/items could not be published/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/all requested items transitioned/i),
    ).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('shows "X of N items could not be published" title when failureCount > 0 (§7.7)', () => {
    const onOpenChange = vi.fn();
    render(
      <PublicationBulkResultDialog
        open
        onOpenChange={onOpenChange}
        response={makeMixedResponse()}
        itemTitleLookup={
          new Map([
            [ID_2, 'Procurement policy 2025'],
            [ID_3, 'Outdated tender response'],
          ])
        }
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(
        /2 of 5 items could not be published/i,
      ),
    ).toBeInTheDocument();
  });

  it('lists each failure with item title from lookup (§7.7)', () => {
    const onOpenChange = vi.fn();
    render(
      <PublicationBulkResultDialog
        open
        onOpenChange={onOpenChange}
        response={makeMixedResponse()}
        itemTitleLookup={
          new Map([
            [ID_2, 'Procurement policy 2025'],
            [ID_3, 'Outdated tender response'],
          ])
        }
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Procurement policy 2025'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Outdated tender response'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/concurrent state change detected/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /role 'editor' cannot transition 'archived' -> 'published'/i,
      ),
    ).toBeInTheDocument();
    // Successful row should NOT appear in the failure list.
    expect(within(dialog).queryByText(ID_1)).not.toBeInTheDocument();
  });

  it('falls back to "<UUID> (item no longer in queue)" when title missing (§7.7)', () => {
    const onOpenChange = vi.fn();
    render(
      <PublicationBulkResultDialog
        open
        onOpenChange={onOpenChange}
        response={makeAllFailedResponse()}
        itemTitleLookup={new Map([[ID_1, 'Found item']])}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Found item')).toBeInTheDocument();
    // The not_found row's id is not in the lookup → fallback string.
    expect(
      within(dialog).getByText(
        new RegExp(`${ID_NOT_IN_LOOKUP}\\s*\\(item no longer in queue\\)`, 'i'),
      ),
    ).toBeInTheDocument();
  });

  it('uses status-fallback reason text when result has no reason/error (not_found case)', () => {
    const onOpenChange = vi.fn();
    render(
      <PublicationBulkResultDialog
        open
        onOpenChange={onOpenChange}
        response={makeAllFailedResponse()}
        itemTitleLookup={new Map()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    // not_found row → "Item no longer exists or is not visible to you."
    expect(
      within(dialog).getByText(
        /item no longer exists or is not visible to you/i,
      ),
    ).toBeInTheDocument();
    // error row with no reason → uses .error field
    expect(
      within(dialog).getByText(/pg connection failure/i),
    ).toBeInTheDocument();
  });

  it('Close button calls onOpenChange(false)', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PublicationBulkResultDialog
        open
        onOpenChange={onOpenChange}
        response={makeMixedResponse()}
        itemTitleLookup={
          new Map([
            [ID_2, 'Procurement policy 2025'],
            [ID_3, 'Outdated tender response'],
          ])
        }
      />,
    );
    const dialog = screen.getByRole('dialog');
    // The Radix DialogContent renders an sr-only "Close" X button in the
    // top-right corner; our DialogFooter also renders a "Close" button. Both
    // are valid affordances; either should fire onOpenChange(false). We pick
    // the footer button by querying all "Close" buttons and clicking the
    // last (visually visible) one.
    const closeBtns = within(dialog).getAllByRole('button', {
      name: /^close$/i,
    });
    await user.click(closeBtns[closeBtns.length - 1]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('all-success response (failureCount=0): shows success summary, no failure list', () => {
    const onOpenChange = vi.fn();
    render(
      <PublicationBulkResultDialog
        open
        onOpenChange={onOpenChange}
        response={makeAllSuccessResponse()}
        itemTitleLookup={new Map()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/4 items published/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/all requested items transitioned successfully/i),
    ).toBeInTheDocument();
    // No failure-list items.
    expect(within(dialog).queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('all-success singular phrasing when successCount === 1', () => {
    const onOpenChange = vi.fn();
    render(
      <PublicationBulkResultDialog
        open
        onOpenChange={onOpenChange}
        response={{
          action: 'approve',
          totalRequested: 1,
          successCount: 1,
          failureCount: 0,
          results: [
            {
              id: ID_1,
              status: 'success',
              previousStatus: 'in_review',
              newStatus: 'published',
            },
          ],
        }}
        itemTitleLookup={new Map()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/^1 item published$/i)).toBeInTheDocument();
  });

  it('partial-success description includes successCount when both buckets non-zero', () => {
    const onOpenChange = vi.fn();
    render(
      <PublicationBulkResultDialog
        open
        onOpenChange={onOpenChange}
        response={makeMixedResponse()}
        itemTitleLookup={new Map()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/3 succeeded; review the failures below/i),
    ).toBeInTheDocument();
  });

  it('all-failed (successCount=0) description directs to the failures list', () => {
    const onOpenChange = vi.fn();
    render(
      <PublicationBulkResultDialog
        open
        onOpenChange={onOpenChange}
        response={makeAllFailedResponse()}
        itemTitleLookup={new Map()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/^review the failures below\.$/i),
    ).toBeInTheDocument();
  });
});
