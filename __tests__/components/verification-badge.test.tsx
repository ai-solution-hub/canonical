/**
 * VerificationBadge Component Tests
 *
 * Binary `Unverified` / `Verified` badge (three-tier `Curated` model retired
 * in S157 WP4). Tests cover the binary states, "Verified by {name}" display,
 * relative time formatting, WCAG multi-channel rendering, and live region.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import {
  VerificationBadge,
  formatRelativeTime,
} from '@/components/shared/verification-badge';

// ---------------------------------------------------------------------------
// formatRelativeTime unit tests
// ---------------------------------------------------------------------------

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for current time', () => {
    expect(formatRelativeTime('2026-03-25T12:00:00Z')).toBe('just now');
  });

  it('returns "5 minutes ago" for 5 minutes', () => {
    expect(formatRelativeTime('2026-03-25T11:55:00Z')).toBe('5 minutes ago');
  });

  it('returns "1 minute ago" for singular', () => {
    expect(formatRelativeTime('2026-03-25T11:59:00Z')).toBe('1 minute ago');
  });

  it('returns "2 hours ago" for 2 hours', () => {
    expect(formatRelativeTime('2026-03-25T10:00:00Z')).toBe('2 hours ago');
  });

  it('returns "1 hour ago" for singular', () => {
    expect(formatRelativeTime('2026-03-25T11:00:00Z')).toBe('1 hour ago');
  });

  it('returns "3 days ago" for 3 days', () => {
    expect(formatRelativeTime('2026-03-22T12:00:00Z')).toBe('3 days ago');
  });

  it('returns "1 day ago" for singular', () => {
    expect(formatRelativeTime('2026-03-24T12:00:00Z')).toBe('1 day ago');
  });

  it('returns "2 weeks ago" for 14 days', () => {
    expect(formatRelativeTime('2026-03-11T12:00:00Z')).toBe('2 weeks ago');
  });

  it('returns "1 month ago" for 30 days', () => {
    expect(formatRelativeTime('2026-02-23T12:00:00Z')).toBe('1 month ago');
  });

  it('returns "2 months ago" for 60+ days', () => {
    expect(formatRelativeTime('2026-01-24T12:00:00Z')).toBe('2 months ago');
  });
});

// ---------------------------------------------------------------------------
// VerificationBadge component tests
// ---------------------------------------------------------------------------

describe('VerificationBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Binary states
  it('renders "Verified" with verified=true', () => {
    render(<VerificationBadge verified />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
    // Default liveRegion is false, so role is "img"
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('renders "Unverified" with verified=false', () => {
    render(<VerificationBadge verified={false} />);
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    // Default role is "img" for unverified too
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('hides label text when showLabel=false', () => {
    render(<VerificationBadge verified showLabel={false} />);
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    // Icon is still rendered (with aria-hidden), badge uses role="img" by default
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  // Verified by name
  it('shows "Verified by {name}" when verifiedByName is provided', () => {
    render(<VerificationBadge verified verifiedByName="Jane Doe" />);
    expect(screen.getByText('Verified by Jane Doe')).toBeInTheDocument();
  });

  // Verified by name + relative time
  it('shows "Verified by {name}, X days ago" with both name and date', () => {
    render(
      <VerificationBadge
        verified
        verifiedByName="John Smith"
        verifiedAt="2026-03-22T12:00:00Z"
      />,
    );
    expect(
      screen.getByText('Verified by John Smith, 3 days ago'),
    ).toBeInTheDocument();
  });

  // Verified with date but no name
  it('shows "Verified X days ago" with date but no name', () => {
    render(<VerificationBadge verified verifiedAt="2026-03-22T12:00:00Z" />);
    expect(screen.getByText('Verified 3 days ago')).toBeInTheDocument();
  });

  // Unverified ignores name/date
  it('shows "Unverified" and ignores name/date when not verified', () => {
    render(
      <VerificationBadge
        verified={false}
        verifiedByName="Should not appear"
        verifiedAt="2026-03-22T12:00:00Z"
      />,
    );
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.queryByText(/Should not appear/)).not.toBeInTheDocument();
  });

  // Curated tier retired — confirm the label no longer exists for any input
  it('never renders "Curated" regardless of props', () => {
    render(
      <VerificationBadge
        verified
        verifiedByName="Alice"
        verifiedAt="2026-03-24T12:00:00Z"
      />,
    );
    expect(screen.queryByText(/Curated/)).not.toBeInTheDocument();
  });

  // Size prop
  it('renders a larger icon at md size', () => {
    const { container } = render(<VerificationBadge verified size="md" />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('size-3.5');
  });

  it('renders a small icon by default', () => {
    const { container } = render(<VerificationBadge verified />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('size-3');
  });

  // className pass-through
  it('reflects a custom className on the outer span', () => {
    render(<VerificationBadge verified className="custom-class" />);
    expect(screen.getByRole('img')).toHaveClass('custom-class');
  });

  // --- liveRegion prop tests ---

  describe('liveRegion prop', () => {
    it('renders with role="status" when liveRegion is true', () => {
      render(<VerificationBadge verified liveRegion />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('exposes a verified badge as role="img" with an aria-label by default (liveRegion=false)', () => {
      render(<VerificationBadge verified verifiedAt="2026-03-22T12:00:00Z" />);
      const badge = screen.getByRole('img');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute('aria-label', 'Verified 3 days ago');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('exposes an unverified badge as role="img" with an aria-label by default (liveRegion=false)', () => {
      render(<VerificationBadge verified={false} />);
      const badge = screen.getByRole('img');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute('aria-label', 'Unverified');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('announces a verified badge as role="status" when liveRegion is true', () => {
      render(<VerificationBadge verified liveRegion />);
      const badge = screen.getByRole('status');
      expect(badge).toBeInTheDocument();
      // Should NOT have aria-label when using role="status" (content is announced directly)
      expect(badge).not.toHaveAttribute('aria-label');
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('announces an unverified badge as role="status" when liveRegion is true', () => {
      render(<VerificationBadge verified={false} liveRegion />);
      const badge = screen.getByRole('status');
      expect(badge).toBeInTheDocument();
      expect(badge).not.toHaveAttribute('aria-label');
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('shows the name-and-time label as an aria-labelled img badge with liveRegion=false', () => {
      render(
        <VerificationBadge
          verified
          verifiedByName="Jane"
          verifiedAt="2026-03-24T12:00:00Z"
        />,
      );
      expect(
        screen.getByText('Verified by Jane, 1 day ago'),
      ).toBeInTheDocument();
      const badge = screen.getByRole('img');
      expect(badge).toHaveAttribute(
        'aria-label',
        'Verified by Jane, 1 day ago',
      );
    });
  });
});
