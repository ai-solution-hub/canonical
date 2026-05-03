/**
 * PublicationBulkActionBar — component tests.
 *
 * Spec: docs/specs/publication-approval-gate-spec.md §3.3, §3.5,
 * §8 AC-bulk-4.x.
 *
 * The bar is props-driven (selection state lives in the queue
 * parent). These tests cover:
 *  - Counter rendering ("N of M selected") — AC-bulk-4.2/4.3
 *  - Master checkbox state (checked/indeterminate/unchecked) — AC-bulk-4.3/4.4
 *  - Approve / Return-to-draft confirmation dialogs (D-4 RATIFIED) — AC-bulk-4.6
 *  - Clear selection — AC-bulk-4.5
 *  - Disabled state while a mutation is pending
 *  - Cap-exceeded UX (D-3 RATIFIED, 50-item cap, client-side defence-in-depth)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PublicationBulkActionBar } from '@/components/review/publication-bulk-action-bar';
import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

// Stable v4 UUID helpers used as content_item ids.
function uuid(n: number): string {
  const hex = n.toString(16).padStart(2, '0');
  return `${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}-${hex}${hex}${hex}${hex}-4${hex}${hex}${hex}-8${hex}${hex}${hex}-${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}`;
}

const ID_1 = uuid(1);
const ID_2 = uuid(2);
const ID_3 = uuid(3);
const ID_4 = uuid(4);

interface RenderOptions {
  selectedIds?: Set<string>;
  pageItemCount?: number;
  isPending?: boolean;
}

function renderBar(opts: RenderOptions = {}) {
  const onSelectAllOnPage = vi.fn();
  const onClearSelection = vi.fn();
  const onApprove = vi.fn();
  const onReturnToDraft = vi.fn();
  const user = userEvent.setup();

  const result = render(
    <PublicationBulkActionBar
      selectedIds={opts.selectedIds ?? new Set([ID_1])}
      pageItemCount={opts.pageItemCount ?? 4}
      onSelectAllOnPage={onSelectAllOnPage}
      onClearSelection={onClearSelection}
      onApprove={onApprove}
      onReturnToDraft={onReturnToDraft}
      isPending={opts.isPending ?? false}
    />,
  );

  return {
    user,
    onSelectAllOnPage,
    onClearSelection,
    onApprove,
    onReturnToDraft,
    ...result,
  };
}

describe('PublicationBulkActionBar', () => {
  beforeEach(() => {
    // Radix AlertDialog uses Portal + pointer events; install shims so jsdom
    // does not fail on pointer-capture / scrollIntoView calls.
    installRadixPointerShims();
    vi.clearAllMocks();
  });

  it('renders toolbar with accessible label and three actions (AC-bulk-4.2 §3.5)', () => {
    renderBar();
    const toolbar = screen.getByRole('toolbar', {
      name: /bulk publication actions/i,
    });
    expect(toolbar).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', {
        name: /approve selected items/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', {
        name: /return selected items to draft/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', { name: /clear selection/i }),
    ).toBeInTheDocument();
  });

  it('counter reads "1 of N selected" when one is selected (AC-bulk-4.2)', () => {
    renderBar({
      selectedIds: new Set([ID_1]),
      pageItemCount: 4,
    });
    expect(screen.getByText('1 of 4 selected')).toBeInTheDocument();
  });

  it('master checkbox is in indeterminate state when 0 < selectedIds.size < pageItemCount (AC-bulk-4.3)', () => {
    renderBar({
      selectedIds: new Set([ID_1, ID_2]),
      pageItemCount: 4,
    });
    const masterCheckbox = screen.getByRole('checkbox', {
      name: /select all items on page/i,
    });
    // Radix Checkbox sets data-state="indeterminate" / aria-checked="mixed".
    expect(masterCheckbox).toHaveAttribute('aria-checked', 'mixed');
  });

  it('master checkbox is checked when all on page selected (AC-bulk-4.4)', () => {
    renderBar({
      selectedIds: new Set([ID_1, ID_2, ID_3, ID_4]),
      pageItemCount: 4,
    });
    const masterCheckbox = screen.getByRole('checkbox', {
      name: /select all items on page/i,
    });
    expect(masterCheckbox).toHaveAttribute('aria-checked', 'true');
  });

  it('clicking master checkbox while none-selected fires onSelectAllOnPage', async () => {
    const { user, onSelectAllOnPage, onClearSelection } = renderBar({
      selectedIds: new Set(),
      pageItemCount: 4,
    });
    const masterCheckbox = screen.getByRole('checkbox', {
      name: /select all items on page/i,
    });
    await user.click(masterCheckbox);
    expect(onSelectAllOnPage).toHaveBeenCalledTimes(1);
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it('clicking master checkbox while all-selected fires onClearSelection', async () => {
    const { user, onSelectAllOnPage, onClearSelection } = renderBar({
      selectedIds: new Set([ID_1, ID_2, ID_3, ID_4]),
      pageItemCount: 4,
    });
    const masterCheckbox = screen.getByRole('checkbox', {
      name: /select all items on page/i,
    });
    await user.click(masterCheckbox);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(onSelectAllOnPage).not.toHaveBeenCalled();
  });

  it('clicking Clear selection fires onClearSelection (AC-bulk-4.5)', async () => {
    const { user, onClearSelection } = renderBar({
      selectedIds: new Set([ID_1, ID_2]),
    });
    await user.click(
      screen.getByRole('button', { name: /clear selection/i }),
    );
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('Approve opens AlertDialog; Cancel closes without firing onApprove (AC-bulk-4.6)', async () => {
    const { user, onApprove } = renderBar({
      selectedIds: new Set([ID_1, ID_2, ID_3]),
    });
    await user.click(
      screen.getByRole('button', { name: /approve selected items/i }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/approve 3 items\?/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /this publishes them to the knowledge base immediately/i,
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('Approve dialog Confirm fires onApprove exactly once (AC-bulk-4.6)', async () => {
    const { user, onApprove } = renderBar({
      selectedIds: new Set([ID_1, ID_2, ID_3]),
    });
    await user.click(
      screen.getByRole('button', { name: /approve selected items/i }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: /^approve$/i }),
    );
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('Approve dialog uses singular phrasing when only 1 item is selected (D-4)', async () => {
    const { user } = renderBar({
      selectedIds: new Set([ID_1]),
    });
    await user.click(
      screen.getByRole('button', { name: /approve selected items/i }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/approve 1 item\?/i)).toBeInTheDocument();
  });

  it('Return to draft opens AlertDialog; Confirm fires onReturnToDraft (AC-bulk-4.6, D-4)', async () => {
    const { user, onReturnToDraft } = renderBar({
      selectedIds: new Set([ID_1, ID_2]),
    });
    await user.click(
      screen.getByRole('button', {
        name: /return selected items to draft/i,
      }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/return 2 items to draft\?/i),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: /^return to draft$/i }),
    );
    expect(onReturnToDraft).toHaveBeenCalledTimes(1);
  });

  it('disables all action buttons when isPending=true', async () => {
    const { user, onApprove, onReturnToDraft, onClearSelection } = renderBar({
      selectedIds: new Set([ID_1, ID_2]),
      isPending: true,
    });
    const approveBtn = screen.getByRole('button', {
      name: /approve selected items/i,
    });
    const returnBtn = screen.getByRole('button', {
      name: /return selected items to draft/i,
    });
    const clearBtn = screen.getByRole('button', { name: /clear selection/i });

    expect(approveBtn).toBeDisabled();
    expect(returnBtn).toBeDisabled();
    expect(clearBtn).toBeDisabled();

    // Clicks on disabled buttons should be no-ops; user-event does not fire
    // click on disabled. Asserting no callback was fired post-click confirms.
    await user.click(approveBtn);
    await user.click(returnBtn);
    await user.click(clearBtn);
    expect(onApprove).not.toHaveBeenCalled();
    expect(onReturnToDraft).not.toHaveBeenCalled();
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it('disables action buttons when selection is empty', () => {
    renderBar({
      selectedIds: new Set(),
      pageItemCount: 4,
    });
    expect(
      screen.getByRole('button', { name: /approve selected items/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /return selected items to draft/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /clear selection/i }),
    ).toBeDisabled();
  });

  it('cap exceeded (>50): renders cap message + action buttons aria-disabled (D-3 RATIFIED)', async () => {
    // Build a Set of 51 distinct UUIDs.
    const big = new Set<string>();
    for (let i = 1; i <= 51; i++) {
      big.add(uuid(i));
    }
    const { user, onApprove, onReturnToDraft } = renderBar({
      selectedIds: big,
      pageItemCount: 51,
    });

    expect(
      screen.getByText(/at most 50 items per request/i),
    ).toBeInTheDocument();

    const approveBtn = screen.getByRole('button', {
      name: /approve selected items/i,
    });
    const returnBtn = screen.getByRole('button', {
      name: /return selected items to draft/i,
    });
    expect(approveBtn).toHaveAttribute('aria-disabled', 'true');
    expect(returnBtn).toHaveAttribute('aria-disabled', 'true');

    // Click should not fire the callback nor open a dialog. The buttons
    // are NOT HTML-disabled (aria-disabled="true" only) so user-event will
    // dispatch the click event; the component's onClick guard rejects it.
    await user.click(approveBtn);
    await user.click(returnBtn);
    expect(onApprove).not.toHaveBeenCalled();
    expect(onReturnToDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('counter live region announces selection count (§3.5 a11y)', () => {
    renderBar({
      selectedIds: new Set([ID_1, ID_2, ID_3]),
      pageItemCount: 4,
    });
    const live = screen.getByText('3 of 4 selected');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });
});
