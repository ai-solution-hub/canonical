/**
 * BulkActionToolbar Component Tests
 *
 * Tests the BulkActionToolbar component — visibility, the Verify/Assign-to-
 * workspace/Delete action buttons, disabled state during operations, and
 * progress bar. ID-135 {135.25} restores Assign-to-workspace and Delete
 * (wiring the {135.22}-shipped `useLibraryBulkActions` handlers) behind
 * confirm dialogs — Assign needs a workspace picked first (Dialog), Delete
 * is a plain yes/no confirm (AlertDialog).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

import {
  BulkActionToolbar,
  type BulkActionToolbarProps,
} from '@/components/browse/bulk-action-toolbar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(
  overrides: Partial<BulkActionToolbarProps> = {},
): BulkActionToolbarProps {
  return {
    selectedCount: 3,
    bulkOperating: false,
    bulkProgress: { current: 0, total: 0, label: '' },
    onBulkVerify: vi.fn(),
    onClearSelection: vi.fn(),
    onBulkDelete: vi.fn(),
    assignDialogOpen: false,
    onAssignDialogOpenChange: vi.fn(),
    engagementGroups: [
      { id: 'eg-1', name: 'Alpha Tender' },
      { id: 'eg-2', name: 'Beta ITT' },
    ],
    engagementGroupsLoading: false,
    selectedEngagementGroupId: '',
    onSelectedEngagementGroupIdChange: vi.fn(),
    onOpenAssignDialog: vi.fn(),
    onConfirmAssign: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BulkActionToolbar', () => {
  beforeEach(() => {
    installRadixPointerShims();
    // jsdom dispatches focus events synchronously; two nested Radix
    // FocusScopes (the Assign Dialog + the workspace Select rendered inside
    // it) refocus each other into "Maximum call stack size exceeded". Real
    // browsers coalesce focus transitions and never loop. Stub focus/blur
    // dispatch so the trap can't fight itself in jsdom (per
    // feedback_radix_select_jsdom_shims — see
    // __tests__/components/entity-management/entity-detail-panel.test.tsx
    // for the same fix against the same Sheet+Select nesting).
    // FIXME(focus-loop): jsdom limitation, not a component bug.
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, 'blur').mockImplementation(() => {});
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when selectedCount is 0', () => {
    const { container } = render(
      <BulkActionToolbar {...defaultProps({ selectedCount: 0 })} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders selected count text', () => {
    render(<BulkActionToolbar {...defaultProps()} />);
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('shows the Verify button', () => {
    render(<BulkActionToolbar {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
  });

  it('disables the Verify button when bulkOperating is true', () => {
    render(<BulkActionToolbar {...defaultProps({ bulkOperating: true })} />);
    expect(screen.getByRole('button', { name: /verify/i })).toBeDisabled();
  });

  it('shows progress bar when bulkOperating is true', () => {
    render(
      <BulkActionToolbar
        {...defaultProps({
          bulkOperating: true,
          bulkProgress: { current: 2, total: 5, label: 'Verifying' },
        })}
      />,
    );
    expect(screen.getByText(/Verifying 2 of 5/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('clear selection button calls onClearSelection', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<BulkActionToolbar {...props} />);
    await user.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(props.onClearSelection).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Assign-to-engagement-group (ID-135 {135.25}; remodelled onto engagement
  // groups by ID-145 {145.35}, BI-33 owner ruling S479)
  // -------------------------------------------------------------------------

  it('shows the Assign to engagement group button', () => {
    render(<BulkActionToolbar {...defaultProps()} />);
    expect(
      screen.getByRole('button', { name: /assign to engagement group/i }),
    ).toBeInTheDocument();
  });

  it('clicking Assign to engagement group calls onOpenAssignDialog', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<BulkActionToolbar {...props} />);
    await user.click(
      screen.getByRole('button', { name: /assign to engagement group/i }),
    );
    expect(props.onOpenAssignDialog).toHaveBeenCalledOnce();
  });

  it('disables Assign to engagement group while bulkOperating', () => {
    render(<BulkActionToolbar {...defaultProps({ bulkOperating: true })} />);
    expect(
      screen.getByRole('button', { name: /assign to engagement group/i }),
    ).toBeDisabled();
  });

  it('assign dialog lists engagement group options when open', async () => {
    const user = userEvent.setup();
    render(<BulkActionToolbar {...defaultProps({ assignDialogOpen: true })} />);

    expect(
      screen.getByText('Assign 3 items to an engagement group'),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText('Select engagement group'));
    expect(
      await screen.findByRole('option', { name: 'Alpha Tender' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Beta ITT' }),
    ).toBeInTheDocument();

    // Close the listbox before the test ends — leaving a Radix Select
    // popup open across test-cleanup unmount recurses infinitely in
    // jsdom's FocusScope teardown (radix-ui/jsdom interaction, not a
    // component bug).
    await user.click(screen.getByRole('option', { name: 'Alpha Tender' }));
  });

  it('selecting an engagement group calls onSelectedEngagementGroupIdChange', async () => {
    const user = userEvent.setup();
    const props = defaultProps({ assignDialogOpen: true });
    render(<BulkActionToolbar {...props} />);

    await user.click(screen.getByLabelText('Select engagement group'));
    await user.click(await screen.findByRole('option', { name: 'Beta ITT' }));

    expect(props.onSelectedEngagementGroupIdChange).toHaveBeenCalledWith(
      'eg-2',
    );
  });

  it('Assign confirm button is disabled until an engagement group is selected', () => {
    render(
      <BulkActionToolbar
        {...defaultProps({
          assignDialogOpen: true,
          selectedEngagementGroupId: '',
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('clicking Assign invokes onConfirmAssign once an engagement group is selected', async () => {
    const user = userEvent.setup();
    const props = defaultProps({
      assignDialogOpen: true,
      selectedEngagementGroupId: 'eg-1',
    });
    render(<BulkActionToolbar {...props} />);

    const assignButton = screen.getByRole('button', { name: 'Assign' });
    expect(assignButton).not.toBeDisabled();
    await user.click(assignButton);
    expect(props.onConfirmAssign).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Delete (ID-135 {135.25})
  // -------------------------------------------------------------------------

  it('shows the Delete button', () => {
    render(<BulkActionToolbar {...defaultProps()} />);
    expect(
      screen.getByRole('button', { name: /^delete$/i }),
    ).toBeInTheDocument();
  });

  it('disables Delete while bulkOperating', () => {
    render(<BulkActionToolbar {...defaultProps({ bulkOperating: true })} />);
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled();
  });

  it('clicking Delete opens a confirm dialog without calling onBulkDelete yet', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<BulkActionToolbar {...props} />);

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByText('Delete 3 items?')).toBeInTheDocument();
    expect(props.onBulkDelete).not.toHaveBeenCalled();
  });

  it('confirming the delete dialog calls onBulkDelete', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<BulkActionToolbar {...props} />);

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(props.onBulkDelete).toHaveBeenCalledOnce();
  });

  it('cancelling the delete dialog does not call onBulkDelete', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<BulkActionToolbar {...props} />);

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onBulkDelete).not.toHaveBeenCalled();
  });
});
