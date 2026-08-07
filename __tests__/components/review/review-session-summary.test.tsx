import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ReviewSessionSummary,
  formatDuration,
} from '@/components/review/review-session-summary';
import type { ReviewSessionStats } from '@/components/review/review-session-summary';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReviewSessionSummary', () => {
  const defaultStats: ReviewSessionStats = {
    total: 15,
    verified: 10,
    flagged: 3,
    skipped: 2,
  };

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    stats: defaultStats,
  };

  it('renders the dialog with correct title', () => {
    render(<ReviewSessionSummary {...defaultProps} />);
    expect(screen.getByText('Session summary')).toBeInTheDocument();
  });

  it('displays all stat values correctly', () => {
    render(<ReviewSessionSummary {...defaultProps} />);

    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('displays stat labels correctly', () => {
    render(<ReviewSessionSummary {...defaultProps} />);

    expect(screen.getByText('Total reviewed')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Flagged')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('displays session duration when provided', () => {
    render(
      <ReviewSessionSummary
        {...defaultProps}
        sessionDuration={125000} // 2m 5s
      />,
    );

    expect(screen.getByText(/Session duration: 2m 5s/)).toBeInTheDocument();
  });

  it('shows "Review session complete" when no duration provided', () => {
    render(<ReviewSessionSummary {...defaultProps} />);
    expect(screen.getByText('Review session complete')).toBeInTheDocument();
  });

  it('renders stats with zero counts correctly', () => {
    const zeroStats: ReviewSessionStats = {
      total: 0,
      verified: 0,
      flagged: 0,
      skipped: 0,
    };

    render(<ReviewSessionSummary {...defaultProps} stats={zeroStats} />);

    // All four stat values should show 0
    const zeros = screen.getAllByText('0');
    expect(zeros).toHaveLength(4);
  });

  it('renders large numbers with locale formatting', () => {
    const largeStats: ReviewSessionStats = {
      total: 1500,
      verified: 1200,
      flagged: 200,
      skipped: 100,
    };

    render(<ReviewSessionSummary {...defaultProps} stats={largeStats} />);

    // en-GB locale formats 1500 as "1,500"
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when Close button is clicked', () => {
    const onOpenChange = vi.fn();

    render(
      <ReviewSessionSummary {...defaultProps} onOpenChange={onOpenChange} />,
    );

    // There are two "Close" buttons (X icon + text button). Get the text one in the footer.
    const closeButtons = screen.getAllByRole('button', { name: /Close/i });
    // The explicit "Close" text button is the one without the sr-only class
    const footerClose = closeButtons.find(
      (btn) =>
        btn.textContent?.trim() === 'Close' && !btn.querySelector('.sr-only'),
    );
    expect(footerClose).toBeTruthy();
    fireEvent.click(footerClose!);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render when open is false', () => {
    render(<ReviewSessionSummary {...defaultProps} open={false} />);

    expect(screen.queryByText('Session summary')).not.toBeInTheDocument();
  });

  it('has accessible stat list with role="list"', () => {
    render(<ReviewSessionSummary {...defaultProps} />);

    const list = screen.getByRole('list', { name: 'Session statistics' });
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
  });
});

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(45000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(125000)).toBe('2m 5s');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(formatDuration(3661000)).toBe('1h 1m 1s');
  });

  it('formats zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats exact minutes', () => {
    expect(formatDuration(120000)).toBe('2m 0s');
  });

  it('formats exact hours', () => {
    expect(formatDuration(3600000)).toBe('1h 0m 0s');
  });
});
