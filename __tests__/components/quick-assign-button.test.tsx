import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickAssignButton } from '@/components/content/quick-assign-button';
import type { ActiveBidWorkspace } from '@/hooks/use-quick-assign';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const WORKSPACES: ActiveBidWorkspace[] = [
  { id: 'ws-1', name: 'Bid Alpha', color: '#ff0000', deadline: '2026-04-15' },
  { id: 'ws-2', name: 'Bid Beta', color: '#00ff00', deadline: null },
];

const ITEM_ID = 'item-001';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuickAssignButton', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders FolderPlus icon when unassigned', () => {
    render(
      <QuickAssignButton
        itemId={ITEM_ID}
        activeWorkspaces={WORKSPACES}
        assignedWorkspaceIds={new Set()}
        onAssignmentChange={mockOnChange}
      />,
    );

    const button = screen.getByRole('button', { name: 'Assign to workspace' });
    expect(button).toBeInTheDocument();
  });

  it('renders FolderCheck icon when assigned to at least one workspace', () => {
    render(
      <QuickAssignButton
        itemId={ITEM_ID}
        activeWorkspaces={WORKSPACES}
        assignedWorkspaceIds={new Set(['ws-1'])}
        onAssignmentChange={mockOnChange}
      />,
    );

    const button = screen.getByRole('button', { name: 'Assigned to 1 workspace' });
    expect(button).toBeInTheDocument();
  });

  it('updates aria-label for multiple assigned workspaces', () => {
    render(
      <QuickAssignButton
        itemId={ITEM_ID}
        activeWorkspaces={WORKSPACES}
        assignedWorkspaceIds={new Set(['ws-1', 'ws-2'])}
        onAssignmentChange={mockOnChange}
      />,
    );

    const button = screen.getByRole('button', { name: 'Assigned to 2 workspaces' });
    expect(button).toBeInTheDocument();
  });

  it('opens popover on click and shows workspaces', async () => {
    const user = userEvent.setup();

    render(
      <QuickAssignButton
        itemId={ITEM_ID}
        activeWorkspaces={WORKSPACES}
        assignedWorkspaceIds={new Set()}
        onAssignmentChange={mockOnChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Assign to workspace' });
    await user.click(trigger);

    // Popover should show workspace names
    expect(screen.getByText('Bid Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bid Beta')).toBeInTheDocument();
  });

  it('shows check mark for assigned workspaces in popover', async () => {
    const user = userEvent.setup();

    render(
      <QuickAssignButton
        itemId={ITEM_ID}
        activeWorkspaces={WORKSPACES}
        assignedWorkspaceIds={new Set(['ws-1'])}
        onAssignmentChange={mockOnChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Assigned to 1 workspace' });
    await user.click(trigger);

    // ws-1 option should be selected
    const ws1Option = screen.getByRole('option', { name: /Bid Alpha/ });
    expect(ws1Option).toHaveAttribute('aria-selected', 'true');

    // ws-2 option should not be selected
    const ws2Option = screen.getByRole('option', { name: /Bid Beta/ });
    expect(ws2Option).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onAssignmentChange with correct args when workspace is clicked', async () => {
    const user = userEvent.setup();

    render(
      <QuickAssignButton
        itemId={ITEM_ID}
        activeWorkspaces={WORKSPACES}
        assignedWorkspaceIds={new Set()}
        onAssignmentChange={mockOnChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Assign to workspace' });
    await user.click(trigger);

    const option = screen.getByRole('option', { name: /Bid Alpha/ });
    await user.click(option);

    expect(mockOnChange).toHaveBeenCalledWith(ITEM_ID, 'ws-1', 'Bid Alpha');
  });

  it('shows empty state when no active workspaces exist', async () => {
    const user = userEvent.setup();

    render(
      <QuickAssignButton
        itemId={ITEM_ID}
        activeWorkspaces={[]}
        assignedWorkspaceIds={new Set()}
        onAssignmentChange={mockOnChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Assign to workspace' });
    await user.click(trigger);

    expect(screen.getByText('No active bids.')).toBeInTheDocument();
    expect(screen.getByText('Create one in Workspaces')).toBeInTheDocument();
  });

  it('shows formatted deadline date', async () => {
    const user = userEvent.setup();

    render(
      <QuickAssignButton
        itemId={ITEM_ID}
        activeWorkspaces={WORKSPACES}
        assignedWorkspaceIds={new Set()}
        onAssignmentChange={mockOnChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Assign to workspace' });
    await user.click(trigger);

    // Should show formatted deadline for Bid Alpha (15 Apr)
    expect(screen.getByText('15 Apr')).toBeInTheDocument();
  });

  it('stopPropagation prevents card navigation on trigger click', async () => {
    const parentClick = vi.fn();
    const user = userEvent.setup();

    render(
       
      <div onClick={parentClick}>
        <QuickAssignButton
          itemId={ITEM_ID}
          activeWorkspaces={WORKSPACES}
          assignedWorkspaceIds={new Set()}
          onAssignmentChange={mockOnChange}
        />
      </div>,
    );

    const trigger = screen.getByRole('button', { name: 'Assign to workspace' });
    await user.click(trigger);

    // Parent click should NOT have been called due to stopPropagation
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('has minimum 44px touch target', () => {
    render(
      <QuickAssignButton
        itemId={ITEM_ID}
        activeWorkspaces={WORKSPACES}
        assignedWorkspaceIds={new Set()}
        onAssignmentChange={mockOnChange}
      />,
    );

    const button = screen.getByRole('button', { name: 'Assign to workspace' });
    // Check that the button has min-h-[44px] min-w-[44px] classes
    expect(button.className).toContain('min-h-[44px]');
    expect(button.className).toContain('min-w-[44px]');
  });

  it('has listbox role on workspace list', async () => {
    const user = userEvent.setup();

    render(
      <QuickAssignButton
        itemId={ITEM_ID}
        activeWorkspaces={WORKSPACES}
        assignedWorkspaceIds={new Set()}
        onAssignmentChange={mockOnChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Assign to workspace' });
    await user.click(trigger);

    const listbox = screen.getByRole('listbox', { name: 'Active bid workspaces' });
    expect(listbox).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // fromBidId shortcut tests
  // -------------------------------------------------------------------------

  describe('fromBidId shortcut', () => {
    it('shows quick-add shortcut when fromBidId matches an active workspace', async () => {
      const user = userEvent.setup();

      render(
        <QuickAssignButton
          itemId={ITEM_ID}
          activeWorkspaces={WORKSPACES}
          assignedWorkspaceIds={new Set()}
          onAssignmentChange={mockOnChange}
          fromBidId="ws-1"
        />,
      );

      const trigger = screen.getByRole('button', { name: 'Assign to workspace' });
      await user.click(trigger);

      const shortcut = screen.getByRole('button', { name: 'Quick add to Bid Alpha' });
      expect(shortcut).toBeInTheDocument();
    });

    it('does not show quick-add shortcut when fromBidId is not provided', async () => {
      const user = userEvent.setup();

      render(
        <QuickAssignButton
          itemId={ITEM_ID}
          activeWorkspaces={WORKSPACES}
          assignedWorkspaceIds={new Set()}
          onAssignmentChange={mockOnChange}
        />,
      );

      const trigger = screen.getByRole('button', { name: 'Assign to workspace' });
      await user.click(trigger);

      expect(screen.queryByRole('button', { name: /Quick add to/ })).not.toBeInTheDocument();
    });

    it('does not show quick-add shortcut when fromBidId does not match any workspace', async () => {
      const user = userEvent.setup();

      render(
        <QuickAssignButton
          itemId={ITEM_ID}
          activeWorkspaces={WORKSPACES}
          assignedWorkspaceIds={new Set()}
          onAssignmentChange={mockOnChange}
          fromBidId="ws-nonexistent"
        />,
      );

      const trigger = screen.getByRole('button', { name: 'Assign to workspace' });
      await user.click(trigger);

      expect(screen.queryByRole('button', { name: /Quick add to/ })).not.toBeInTheDocument();
    });

    it('clicking quick-add shortcut triggers assignment', async () => {
      const user = userEvent.setup();

      render(
        <QuickAssignButton
          itemId={ITEM_ID}
          activeWorkspaces={WORKSPACES}
          assignedWorkspaceIds={new Set()}
          onAssignmentChange={mockOnChange}
          fromBidId="ws-1"
        />,
      );

      const trigger = screen.getByRole('button', { name: 'Assign to workspace' });
      await user.click(trigger);

      const shortcut = screen.getByRole('button', { name: 'Quick add to Bid Alpha' });
      await user.click(shortcut);

      expect(mockOnChange).toHaveBeenCalledWith(ITEM_ID, 'ws-1', 'Bid Alpha');
    });

    it('shows check mark on quick-add shortcut when already assigned', async () => {
      const user = userEvent.setup();

      render(
        <QuickAssignButton
          itemId={ITEM_ID}
          activeWorkspaces={WORKSPACES}
          assignedWorkspaceIds={new Set(['ws-1'])}
          onAssignmentChange={mockOnChange}
          fromBidId="ws-1"
        />,
      );

      const trigger = screen.getByRole('button', { name: 'Assigned to 1 workspace' });
      await user.click(trigger);

      const shortcut = screen.getByRole('button', { name: 'Quick add to Bid Alpha' });
      expect(shortcut).toBeInTheDocument();

      // The shortcut should contain a Check icon (svg element within the button)
      // We can verify by checking the shortcut contains an svg (the Check icon)
      const svgInShortcut = shortcut.querySelector('svg');
      expect(svgInShortcut).not.toBeNull();
    });

    it('quick-add shortcut has visually distinct styling', async () => {
      const user = userEvent.setup();

      render(
        <QuickAssignButton
          itemId={ITEM_ID}
          activeWorkspaces={WORKSPACES}
          assignedWorkspaceIds={new Set()}
          onAssignmentChange={mockOnChange}
          fromBidId="ws-2"
        />,
      );

      const trigger = screen.getByRole('button', { name: 'Assign to workspace' });
      await user.click(trigger);

      const shortcut = screen.getByRole('button', { name: 'Quick add to Bid Beta' });
      // Should have primary-coloured styling (bg-primary/10, text-primary)
      expect(shortcut.className).toContain('text-primary');
    });
  });
});
