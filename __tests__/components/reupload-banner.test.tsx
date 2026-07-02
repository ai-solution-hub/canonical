/**
 * ReuploadBanner Component Tests
 *
 * Tests all render states and interactions for the banner displayed
 * during file upload when a re-upload is detected.
 *
 * Verifies:
 *  - Identical match rendering (amber warning)
 *  - New version rendering (blue info)
 *  - Diff link visibility when diff is available
 *  - Data attributes for parent document tracking
 *  - Semantic colour tokens (no raw Tailwind)
 *  - Accessibility attributes (role, aria-live, aria-hidden)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { ReuploadBanner } from '@/components/source-document/reupload-banner';

// ---------------------------------------------------------------------------
// Identical match
// ---------------------------------------------------------------------------

describe('ReuploadBanner — identical match', () => {
  it('renders "Duplicate file detected" heading', () => {
    render(
      <ReuploadBanner
        matchType="identical"
        previousVersion={2}
        previousDocumentId="doc-prev-1"
      />,
    );

    expect(screen.getByText('Duplicate file detected')).toBeInTheDocument();
  });

  it('includes the previous version number in the description', () => {
    render(
      <ReuploadBanner
        matchType="identical"
        previousVersion={3}
        previousDocumentId="doc-prev-1"
      />,
    );

    expect(
      screen.getByText(/Version 3 was uploaded previously/),
    ).toBeInTheDocument();
  });

  it('shows the identical-match banner in the aging freshness style, not raw Tailwind colours', () => {
    const { container } = render(
      <ReuploadBanner
        matchType="identical"
        previousVersion={1}
        previousDocumentId="doc-prev-1"
      />,
    );

    const alertDiv = container.querySelector('[role="alert"]');
    expect(alertDiv).toBeTruthy();
    const classes = alertDiv!.className;
    // Should reference semantic tokens
    expect(classes).toContain('freshness-aging');
    // Should NOT contain raw Tailwind colour classes
    expect(classes).not.toMatch(/\bbg-amber-\d/);
    expect(classes).not.toMatch(/\bbg-yellow-\d/);
  });

  it('does not show a diff link', () => {
    render(
      <ReuploadBanner
        matchType="identical"
        previousVersion={1}
        previousDocumentId="doc-prev-1"
      />,
    );

    expect(screen.queryByText(/Review Q&A changes/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// New version match
// ---------------------------------------------------------------------------

describe('ReuploadBanner — new version', () => {
  it('renders "Updated document detected" heading', () => {
    render(
      <ReuploadBanner
        matchType="new_version"
        previousVersion={2}
        previousDocumentId="doc-prev-2"
      />,
    );

    expect(screen.getByText('Updated document detected')).toBeInTheDocument();
  });

  it('shows the incremented version number', () => {
    render(
      <ReuploadBanner
        matchType="new_version"
        previousVersion={4}
        previousDocumentId="doc-prev-2"
      />,
    );

    expect(screen.getByText(/Creating version 5/)).toBeInTheDocument();
  });

  it('shows the new-version banner in the primary style, not the aging freshness style', () => {
    const { container } = render(
      <ReuploadBanner
        matchType="new_version"
        previousVersion={1}
        previousDocumentId="doc-prev-2"
      />,
    );

    const alertDiv = container.querySelector('[role="alert"]');
    expect(alertDiv).toBeTruthy();
    const classes = alertDiv!.className;
    expect(classes).toContain('primary');
    expect(classes).not.toContain('freshness-aging');
  });
});

// ---------------------------------------------------------------------------
// Diff link RETIRED (ID-117.12): the diffAvailable/diffDocumentId props and the
// "Review Q&A changes" link were removed. The banner never renders a diff link
// now; the "does not show a diff link" cases above remain as regression guards.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('ReuploadBanner — accessibility', () => {
  it('has role="alert" on the container', () => {
    render(
      <ReuploadBanner
        matchType="identical"
        previousVersion={1}
        previousDocumentId="doc-abc"
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('has aria-live="polite"', () => {
    render(
      <ReuploadBanner
        matchType="identical"
        previousVersion={1}
        previousDocumentId="doc-abc"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'polite');
  });

  it('stores previous document ID as a data attribute', () => {
    render(
      <ReuploadBanner
        matchType="new_version"
        previousVersion={2}
        previousDocumentId="doc-xyz-999"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-previous-document-id', 'doc-xyz-999');
  });

  it('marks icons as aria-hidden', () => {
    const { container } = render(
      <ReuploadBanner
        matchType="identical"
        previousVersion={1}
        previousDocumentId="doc-abc"
      />,
    );

    const hiddenIcons = container.querySelectorAll('[aria-hidden="true"]');
    expect(hiddenIcons.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// className pass-through
// ---------------------------------------------------------------------------

describe('ReuploadBanner — className', () => {
  it('renders the caller-provided className on the alert container', () => {
    const { container } = render(
      <ReuploadBanner
        matchType="identical"
        previousVersion={1}
        previousDocumentId="doc-abc"
        className="mt-4"
      />,
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert!.className).toContain('mt-4');
  });
});
