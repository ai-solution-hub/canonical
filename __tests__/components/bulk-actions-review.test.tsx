import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkActions } from '@/components/browse/bulk-actions';

describe('BulkActions — Send to review', () => {
  const defaultProps = {
    selectedCount: 3,
    onMarkSelectedRead: vi.fn(),
    onCancel: vi.fn(),
  };

  it('does not show "Send to review" when canSendToReview is false', () => {
    render(<BulkActions {...defaultProps} canSendToReview={false} />);

    expect(screen.queryByRole('button', { name: /send to review/i })).not.toBeInTheDocument();
  });

  it('does not show "Send to review" when canSendToReview is omitted', () => {
    render(<BulkActions {...defaultProps} />);

    expect(screen.queryByRole('button', { name: /send to review/i })).not.toBeInTheDocument();
  });

  it('shows "Send to review" when canSendToReview is true and onSendToReview provided', () => {
    render(
      <BulkActions
        {...defaultProps}
        canSendToReview={true}
        onSendToReview={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /send to review/i })).toBeInTheDocument();
  });

  it('calls onSendToReview when button is clicked', async () => {
    const user = userEvent.setup();
    const onSendToReview = vi.fn();

    render(
      <BulkActions
        {...defaultProps}
        canSendToReview={true}
        onSendToReview={onSendToReview}
      />,
    );

    await user.click(screen.getByRole('button', { name: /send to review/i }));
    expect(onSendToReview).toHaveBeenCalledTimes(1);
  });

  it('disables "Send to review" button when isSendingToReview is true', () => {
    render(
      <BulkActions
        {...defaultProps}
        canSendToReview={true}
        onSendToReview={vi.fn()}
        isSendingToReview={true}
      />,
    );

    const button = screen.getByRole('button', { name: /send to review/i });
    expect(button).toBeDisabled();
  });

  it('shows loading spinner when isSendingToReview is true', () => {
    const { container } = render(
      <BulkActions
        {...defaultProps}
        canSendToReview={true}
        onSendToReview={vi.fn()}
        isSendingToReview={true}
      />,
    );

    // The Loader2 icon should have the animate-spin class
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('still shows "Mark as read" and "Cancel" alongside "Send to review"', () => {
    render(
      <BulkActions
        {...defaultProps}
        canSendToReview={true}
        onSendToReview={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /mark as read/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send to review/i })).toBeInTheDocument();
  });

  it('displays the correct selected count', () => {
    render(
      <BulkActions
        {...defaultProps}
        selectedCount={7}
        canSendToReview={true}
        onSendToReview={vi.fn()}
      />,
    );

    expect(screen.getByText('7 selected')).toBeInTheDocument();
  });
});
