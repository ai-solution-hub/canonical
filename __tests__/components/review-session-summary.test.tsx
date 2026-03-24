import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ReviewSessionSummary,
  formatDuration,
  formatUkDateTime,
  generateSummaryText,
} from '@/components/review/review-session-summary';
import type { ReviewSessionStats } from '@/components/review/review-session-summary';

// Mock URL.createObjectURL and URL.revokeObjectURL
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();

beforeEach(() => {
  global.URL.createObjectURL = mockCreateObjectURL;
  global.URL.revokeObjectURL = mockRevokeObjectURL;
});

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

    render(
      <ReviewSessionSummary {...defaultProps} stats={zeroStats} />,
    );

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

    render(
      <ReviewSessionSummary {...defaultProps} stats={largeStats} />,
    );

    // en-GB locale formats 1500 as "1,500"
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when Close button is clicked', () => {
    const onOpenChange = vi.fn();

    render(
      <ReviewSessionSummary
        {...defaultProps}
        onOpenChange={onOpenChange}
      />,
    );

    // There are two "Close" buttons (X icon + text button). Get the text one in the footer.
    const closeButtons = screen.getAllByRole('button', { name: /Close/i });
    // The explicit "Close" text button is the one without the sr-only class
    const footerClose = closeButtons.find(
      (btn) => btn.textContent?.trim() === 'Close' && !btn.querySelector('.sr-only'),
    );
    expect(footerClose).toBeTruthy();
    fireEvent.click(footerClose!);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('creates a blob URL when Download summary is clicked', () => {
    // Spy on createElement to intercept anchor creation, but still let it work
    const mockClick = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...args: unknown[]) => {
      const el = originalCreateElement(tag, ...args as []);
      if (tag === 'a') {
        // Override click to capture it
        el.click = mockClick;
      }
      return el;
    });

    render(
      <ReviewSessionSummary
        {...defaultProps}
        sessionDuration={60000}
      />,
    );

    const downloadButton = screen.getByRole('button', { name: /Download summary/i });
    fireEvent.click(downloadButton);

    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = mockCreateObjectURL.mock.calls[0][0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it('does not render when open is false', () => {
    render(
      <ReviewSessionSummary
        {...defaultProps}
        open={false}
      />,
    );

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

describe('formatUkDateTime', () => {
  it('formats date in DD/MM/YYYY HH:MM format', () => {
    // 15th March 2026 at 14:30
    const date = new Date(2026, 2, 15, 14, 30, 0);
    expect(formatUkDateTime(date)).toBe('15/03/2026 14:30');
  });

  it('pads single-digit day and month', () => {
    // 5th January 2026 at 09:05
    const date = new Date(2026, 0, 5, 9, 5, 0);
    expect(formatUkDateTime(date)).toBe('05/01/2026 09:05');
  });

  it('handles midnight correctly', () => {
    const date = new Date(2026, 5, 20, 0, 0, 0);
    expect(formatUkDateTime(date)).toBe('20/06/2026 00:00');
  });
});

describe('generateSummaryText', () => {
  const stats: ReviewSessionStats = {
    total: 15,
    verified: 10,
    flagged: 3,
    skipped: 2,
  };

  it('includes all stat lines', () => {
    const text = generateSummaryText(stats);

    expect(text).toContain('Review Session Summary');
    expect(text).toContain('Total reviewed: 15');
    expect(text).toContain('Verified: 10');
    expect(text).toContain('Flagged: 3');
    expect(text).toContain('Skipped: 2');
  });

  it('includes UK-formatted date', () => {
    const text = generateSummaryText(stats);
    // Should match DD/MM/YYYY HH:MM pattern
    expect(text).toMatch(/Date: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  });

  it('includes duration when provided', () => {
    const text = generateSummaryText(stats, 125000);
    expect(text).toContain('Duration: 2m 5s');
  });

  it('omits duration line when not provided', () => {
    const text = generateSummaryText(stats);
    expect(text).not.toContain('Duration:');
  });

  it('handles zero stats', () => {
    const zeroStats: ReviewSessionStats = {
      total: 0,
      verified: 0,
      flagged: 0,
      skipped: 0,
    };
    const text = generateSummaryText(zeroStats);

    expect(text).toContain('Total reviewed: 0');
    expect(text).toContain('Verified: 0');
    expect(text).toContain('Flagged: 0');
    expect(text).toContain('Skipped: 0');
  });
});
