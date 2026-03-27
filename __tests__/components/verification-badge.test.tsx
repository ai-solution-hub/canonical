/**
 * VerificationBadge Component Tests
 *
 * Tests basic verified/unverified, "Verified by {name}" display,
 * relative time formatting, trust levels, role-gating, and backwards compat.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import {
  VerificationBadge,
  getTrustLevel,
  formatRelativeTime,
} from '@/components/verification-badge';

// ---------------------------------------------------------------------------
// getTrustLevel unit tests
// ---------------------------------------------------------------------------

describe('getTrustLevel', () => {
  it('returns 1 (Unverified) when not verified', () => {
    expect(getTrustLevel(false)).toBe(1);
  });

  it('returns 1 (Unverified) when not verified, even with trust data', () => {
    expect(
      getTrustLevel(false, {
        brief: 'brief',
        detail: 'detail',
        content_owner_id: 'user-1',
      }),
    ).toBe(1);
  });

  it('returns 2 (Verified) when verified but missing trust data', () => {
    expect(getTrustLevel(true)).toBe(2);
  });

  it('returns 2 (Verified) when verified but trust data is null', () => {
    expect(getTrustLevel(true, null)).toBe(2);
  });

  it('returns 2 (Verified) when verified but trust data is partial', () => {
    expect(getTrustLevel(true, { brief: 'brief', detail: null, content_owner_id: 'user-1' })).toBe(2);
  });

  it('returns 2 (Verified) when verified but brief is empty string', () => {
    expect(getTrustLevel(true, { brief: '', detail: 'detail', content_owner_id: 'user-1' })).toBe(2);
  });

  it('returns 2 (Verified) when verified but content_owner_id is null', () => {
    expect(getTrustLevel(true, { brief: 'brief', detail: 'detail', content_owner_id: null })).toBe(2);
  });

  it('returns 3 (Curated) when verified with all trust data present', () => {
    expect(
      getTrustLevel(true, {
        brief: 'Executive summary',
        detail: 'Detailed explanation',
        content_owner_id: 'user-123',
      }),
    ).toBe(3);
  });
});

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

  // Backwards compatibility
  it('renders "Verified" with just verified=true', () => {
    render(<VerificationBadge verified />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
    // Default role is "img" (not "status") to avoid excessive screen reader announcements
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
    // Icon is still rendered (with aria-hidden)
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
    render(
      <VerificationBadge verified verifiedAt="2026-03-22T12:00:00Z" />,
    );
    expect(screen.getByText('Verified 3 days ago')).toBeInTheDocument();
  });

  // Trust level: curated with detailed trust
  it('shows "Curated" when showDetailedTrust is true and item is fully curated', () => {
    render(
      <VerificationBadge
        verified
        showDetailedTrust
        trustData={{
          brief: 'Executive summary',
          detail: 'Detailed explanation',
          content_owner_id: 'user-123',
        }}
      />,
    );
    expect(screen.getByText('Curated')).toBeInTheDocument();
  });

  // Trust level role-gating: curated collapses to verified
  it('collapses "Curated" to "Verified" when showDetailedTrust is false', () => {
    render(
      <VerificationBadge
        verified
        showDetailedTrust={false}
        trustData={{
          brief: 'Executive summary',
          detail: 'Detailed explanation',
          content_owner_id: 'user-123',
        }}
      />,
    );
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.queryByText('Curated')).not.toBeInTheDocument();
  });

  // Curated with name and date
  it('shows "Curated by {name}, X days ago" in detailed trust mode', () => {
    render(
      <VerificationBadge
        verified
        verifiedByName="Alice"
        verifiedAt="2026-03-24T12:00:00Z"
        showDetailedTrust
        trustData={{
          brief: 'brief',
          detail: 'detail',
          content_owner_id: 'user-1',
        }}
      />,
    );
    expect(
      screen.getByText('Curated by Alice, 1 day ago'),
    ).toBeInTheDocument();
  });

  // tooltipOnly mode
  it('shows short label inline and full label in title when tooltipOnly is true', () => {
    render(
      <VerificationBadge
        verified
        verifiedByName="Bob"
        verifiedAt="2026-03-22T12:00:00Z"
        tooltipOnly
      />,
    );
    // Short label shown inline
    expect(screen.getByText('Verified')).toBeInTheDocument();
    // Full label in title attribute
    const badge = screen.getByRole('img');
    expect(badge).toHaveAttribute(
      'title',
      'Verified by Bob, 3 days ago',
    );
  });

  // tooltipOnly with no extra info
  it('does not show tooltip when tooltipOnly but no extra info', () => {
    render(<VerificationBadge verified tooltipOnly />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
    const badge = screen.getByRole('img');
    // No title when full label equals short label
    expect(badge).not.toHaveAttribute('title');
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

  // Size prop
  it('applies size classes correctly', () => {
    const { container } = render(<VerificationBadge verified size="md" />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('size-3.5');
  });

  it('applies sm size by default', () => {
    const { container } = render(<VerificationBadge verified />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('size-3');
  });

  // className pass-through
  it('passes className to the outer span', () => {
    render(<VerificationBadge verified className="custom-class" />);
    expect(screen.getByRole('img')).toHaveClass('custom-class');
  });

  // --- liveRegion prop tests ---

  describe('liveRegion prop', () => {
    it('uses role="img" with aria-label by default (liveRegion=false) for verified badge', () => {
      render(<VerificationBadge verified verifiedAt="2026-03-22T12:00:00Z" />);
      const badge = screen.getByRole('img');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute('aria-label', 'Verified 3 days ago');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('uses role="img" with aria-label by default (liveRegion=false) for unverified badge', () => {
      render(<VerificationBadge verified={false} />);
      const badge = screen.getByRole('img');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute('aria-label', 'Unverified');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('uses role="status" when liveRegion is true for verified badge', () => {
      render(<VerificationBadge verified liveRegion />);
      const badge = screen.getByRole('status');
      expect(badge).toBeInTheDocument();
      // Should NOT have aria-label when using role="status" (content is announced directly)
      expect(badge).not.toHaveAttribute('aria-label');
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('uses role="status" when liveRegion is true for unverified badge', () => {
      render(<VerificationBadge verified={false} liveRegion />);
      const badge = screen.getByRole('status');
      expect(badge).toBeInTheDocument();
      expect(badge).not.toHaveAttribute('aria-label');
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('preserves existing badge behaviour with liveRegion=false', () => {
      render(
        <VerificationBadge
          verified
          verifiedByName="Jane"
          verifiedAt="2026-03-24T12:00:00Z"
        />,
      );
      expect(screen.getByText('Verified by Jane, 1 day ago')).toBeInTheDocument();
      const badge = screen.getByRole('img');
      expect(badge).toHaveAttribute('aria-label', 'Verified by Jane, 1 day ago');
    });
  });
});
