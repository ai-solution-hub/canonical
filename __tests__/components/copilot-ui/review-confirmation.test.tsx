/**
 * ReviewConfirmation Component Tests
 *
 * Tests the human-in-the-loop confirmation UI for bid response review,
 * including null state, button rendering, loading state, and callbacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ReviewConfirmation } from '@/components/copilot-ui/review-confirmation';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewConfirmation', () => {
  const defaultProps = {
    questionId: 'q-123' as string | null,
    isLoading: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onConfirm = vi.fn();
    defaultProps.onCancel = vi.fn();
  });

  it('shows "No question selected" when questionId is null', () => {
    render(<ReviewConfirmation {...defaultProps} questionId={null} />);

    expect(screen.getByText('No question selected')).toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
  });

  it('shows confirm and cancel buttons when questionId exists', () => {
    render(<ReviewConfirmation {...defaultProps} />);

    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('disables buttons when isLoading is true', () => {
    render(<ReviewConfirmation {...defaultProps} isLoading={true} />);

    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('calls onConfirm when confirm button is clicked', async () => {
    const user = userEvent.setup();
    render(<ReviewConfirmation {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /confirm/i }));

    expect(defaultProps.onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<ReviewConfirmation {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(defaultProps.onCancel).toHaveBeenCalledOnce();
  });
});
