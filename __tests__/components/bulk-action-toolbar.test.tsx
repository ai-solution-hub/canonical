/**
 * BulkActionToolbar Component Tests
 *
 * Tests the BulkActionToolbar component — visibility, the Verify action
 * button, disabled state during operations, and progress bar. ID-139
 * {139.9}: Reclassify/Tag/Assign/Delete were retired (dead /api/items/*
 * affordances) — Verify is the only surviving bulk action.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BulkActionToolbar', () => {
  beforeEach(() => {
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
});
