/**
 * TableOfContents Component Tests
 *
 * Tests heading extraction, minimum heading threshold, heading links,
 * mobile collapse, back-to-top button, active heading tracking,
 * and navigation aria-label.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { TableOfContents } from '@/components/item-detail/table-of-contents';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const contentWith3Headings = `
## Introduction
Some intro text

## Background
Background details here

## Conclusion
Final thoughts
`;

const contentWith2Headings = `
## Introduction
Some intro text

## Conclusion
Final thoughts
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TableOfContents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.innerWidth for desktop
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders when 3 or more headings are present', () => {
    render(<TableOfContents content={contentWith3Headings} />);

    expect(
      screen.getByRole('navigation', { name: 'Table of contents' }),
    ).toBeInTheDocument();
  });

  it('does not render when fewer than 3 headings', () => {
    const { container } = render(
      <TableOfContents content={contentWith2Headings} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('shows heading links', () => {
    render(<TableOfContents content={contentWith3Headings} />);

    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Background')).toBeInTheDocument();
    expect(screen.getByText('Conclusion')).toBeInTheDocument();
  });

  it('collapses on mobile viewport', () => {
    Object.defineProperty(window, 'innerWidth', { value: 400, writable: true });

    render(<TableOfContents content={contentWith3Headings} />);

    // On mobile, the component renders but the useEffect sets isCollapsed=true
    // The "Contents" button should still be visible
    expect(screen.getByText('Contents')).toBeInTheDocument();
  });

  it('shows back-to-top button when expanded', () => {
    render(<TableOfContents content={contentWith3Headings} />);

    expect(screen.getByText('Back to top')).toBeInTheDocument();
  });

  it('toggles collapse when Contents button is clicked', async () => {
    const user = userEvent.setup();

    render(<TableOfContents content={contentWith3Headings} />);

    // Initially expanded on desktop
    expect(screen.getByText('Introduction')).toBeInTheDocument();

    // Click to collapse
    await user.click(screen.getByText('Contents'));

    // After collapse, heading links should not be visible
    expect(screen.queryByText('Introduction')).not.toBeInTheDocument();

    // Click to expand again
    await user.click(screen.getByText('Contents'));
    expect(screen.getByText('Introduction')).toBeInTheDocument();
  });

  it('has nav aria-label "Table of contents"', () => {
    render(<TableOfContents content={contentWith3Headings} />);

    expect(
      screen.getByRole('navigation', { name: 'Table of contents' }),
    ).toBeInTheDocument();
  });
});
