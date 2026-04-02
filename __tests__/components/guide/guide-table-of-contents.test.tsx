/**
 * GuideTableOfContents Component Tests
 *
 * Tests section rendering, minimum section threshold, scroll-to navigation,
 * mobile collapse, back-to-top button, active section tracking indicators,
 * and accessibility attributes.
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

import {
  GuideTableOfContents,
  type GuideTocSection,
} from '@/components/guide/guide-table-of-contents';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSections(count: number): GuideTocSection[] {
  return Array.from({ length: count }, (_, i) => ({
    section_id: `section-${i + 1}`,
    section_name: `Section ${i + 1}`,
    is_required: i < 2, // first two are required
    has_content: i === 0, // only first has content
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuideTableOfContents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders when 3 or more sections are present', () => {
    render(<GuideTableOfContents sections={makeSections(3)} />);

    expect(
      screen.getByRole('navigation', { name: 'Guide sections' }),
    ).toBeInTheDocument();
  });

  it('does not render when fewer than 3 sections', () => {
    const { container } = render(
      <GuideTableOfContents sections={makeSections(2)} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders all section names', () => {
    render(<GuideTableOfContents sections={makeSections(4)} />);

    expect(screen.getByText('Section 1')).toBeInTheDocument();
    expect(screen.getByText('Section 2')).toBeInTheDocument();
    expect(screen.getByText('Section 3')).toBeInTheDocument();
    expect(screen.getByText('Section 4')).toBeInTheDocument();
  });

  it('renders section numbers', () => {
    render(<GuideTableOfContents sections={makeSections(3)} />);

    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(screen.getByText('3.')).toBeInTheDocument();
  });

  it('shows back-to-top button when expanded', () => {
    render(<GuideTableOfContents sections={makeSections(3)} />);

    expect(screen.getByText('Back to top')).toBeInTheDocument();
  });

  it('toggles collapse when Sections button is clicked', async () => {
    const user = userEvent.setup();

    render(<GuideTableOfContents sections={makeSections(3)} />);

    // Initially expanded on desktop
    expect(screen.getByText('Section 1')).toBeInTheDocument();

    // Click to collapse
    await user.click(screen.getByText('Sections'));

    // After collapse, section names should not be visible
    expect(screen.queryByText('Section 1')).not.toBeInTheDocument();

    // Click to expand again
    await user.click(screen.getByText('Sections'));
    expect(screen.getByText('Section 1')).toBeInTheDocument();
  });

  it('collapses on mobile viewport', () => {
    Object.defineProperty(window, 'innerWidth', {
      value: 400,
      writable: true,
    });

    render(<GuideTableOfContents sections={makeSections(3)} />);

    // The Sections button should still be visible
    expect(screen.getByText('Sections')).toBeInTheDocument();
  });

  it('has navigation aria-label "Guide sections"', () => {
    render(<GuideTableOfContents sections={makeSections(3)} />);

    expect(
      screen.getByRole('navigation', { name: 'Guide sections' }),
    ).toBeInTheDocument();
  });

  it('shows status indicators for sections', () => {
    const sections: GuideTocSection[] = [
      {
        section_id: 'sec-1',
        section_name: 'Has Content',
        is_required: true,
        has_content: true,
      },
      {
        section_id: 'sec-2',
        section_name: 'Required Empty',
        is_required: true,
        has_content: false,
      },
      {
        section_id: 'sec-3',
        section_name: 'Optional Empty',
        is_required: false,
        has_content: false,
      },
    ];

    render(<GuideTableOfContents sections={sections} />);

    // Section with content should show green indicator
    expect(screen.getByLabelText('Section has content')).toBeInTheDocument();

    // Required section without content should show red indicator
    expect(
      screen.getByLabelText('Required section with no content'),
    ).toBeInTheDocument();
  });

  it('respects custom minSections threshold', () => {
    const { container } = render(
      <GuideTableOfContents sections={makeSections(4)} minSections={5} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders section links with correct href anchors', () => {
    render(<GuideTableOfContents sections={makeSections(3)} />);

    const link1 = screen.getByText('Section 1').closest('a');
    expect(link1).toHaveAttribute('href', '#section-1');

    const link2 = screen.getByText('Section 2').closest('a');
    expect(link2).toHaveAttribute('href', '#section-2');
  });

  it('calls scrollIntoView when a section link is clicked', async () => {
    const user = userEvent.setup();
    const mockScrollIntoView = vi.fn();

    // Create a mock DOM element for the section
    const mockElement = document.createElement('div');
    mockElement.id = 'section-1';
    mockElement.scrollIntoView = mockScrollIntoView;
    document.body.appendChild(mockElement);

    render(<GuideTableOfContents sections={makeSections(3)} />);

    await user.click(screen.getByText('Section 1'));

    expect(mockScrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });

    document.body.removeChild(mockElement);
  });

  it('applies custom className', () => {
    render(
      <GuideTableOfContents
        sections={makeSections(3)}
        className="my-custom-class"
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Guide sections' });
    expect(nav.className).toContain('my-custom-class');
  });
});
