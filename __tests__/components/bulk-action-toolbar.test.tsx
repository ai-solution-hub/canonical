/**
 * BulkActionToolbar Component Tests
 *
 * Tests the BulkActionToolbar component — visibility, action buttons,
 * admin-gated delete, disabled state during operations, and progress bar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BulkActionToolbar, type BulkActionToolbarProps } from '@/components/browse/bulk-action-toolbar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<BulkActionToolbarProps> = {}): BulkActionToolbarProps {
  return {
    selectedCount: 3,
    isAdmin: false,
    bulkOperating: false,
    bulkProgress: { current: 0, total: 0, label: '' },
    onBulkReclassify: vi.fn(),
    onBulkTag: vi.fn(),
    onBulkAssign: vi.fn(),
    onBulkVerify: vi.fn(),
    onBulkDelete: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BulkActionToolbar', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns null when selectedCount is 0', () => {
    const { container } = render(<BulkActionToolbar {...defaultProps({ selectedCount: 0 })} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders selected count text', () => {
    render(<BulkActionToolbar {...defaultProps()} />);
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('shows Re-classify, Tag, Assign, Verify buttons', () => {
    render(<BulkActionToolbar {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /re-classify/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tag/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /assign to workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
  });

  it('shows Delete button when isAdmin is true', () => {
    render(<BulkActionToolbar {...defaultProps({ isAdmin: true })} />);
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('hides Delete button when isAdmin is false', () => {
    render(<BulkActionToolbar {...defaultProps({ isAdmin: false })} />);
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('disables action buttons when bulkOperating is true', () => {
    render(<BulkActionToolbar {...defaultProps({ bulkOperating: true })} />);
    expect(screen.getByRole('button', { name: /re-classify/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /tag/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /assign to workspace/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /verify/i })).toBeDisabled();
  });

  it('shows progress bar when bulkOperating is true', () => {
    render(
      <BulkActionToolbar
        {...defaultProps({
          bulkOperating: true,
          bulkProgress: { current: 2, total: 5, label: 'Re-classifying' },
        })}
      />,
    );
    expect(screen.getByText(/Re-classifying 2 of 5/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('clear selection button calls onClearSelection', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<BulkActionToolbar {...props} />);
    await user.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(props.onClearSelection).toHaveBeenCalledOnce();
  });
});
