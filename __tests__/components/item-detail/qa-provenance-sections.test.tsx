/**
 * QAProvenanceSections Component Tests
 *
 * Tests QAUsedInProcurements and QARelatedPairs — empty state returns null,
 * workspace/pair rendering, link targets, and "Untitled" fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import {
  QAUsedInProcurements,
  QARelatedPairs,
} from '@/components/item-detail/qa-provenance-sections';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QAUsedInProcurements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when workspaces array is empty', () => {
    const { container } = render(<QAUsedInProcurements workspaces={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows workspace count in heading', () => {
    const workspaces = [
      { id: 'w1', name: 'Project Alpha' },
      { id: 'w2', name: 'Project Beta' },
    ];
    render(<QAUsedInProcurements workspaces={workspaces} />);
    expect(screen.getByText(/Used in 2 bids/i)).toBeInTheDocument();
  });

  it('renders workspace links with correct hrefs', () => {
    const workspaces = [
      { id: 'w1', name: 'Project Alpha' },
      { id: 'w2', name: 'Project Beta' },
    ];
    render(<QAUsedInProcurements workspaces={workspaces} />);
    expect(screen.getByText('Project Alpha').closest('a')).toHaveAttribute(
      'href',
      '/procurement/w1',
    );
    expect(screen.getByText('Project Beta').closest('a')).toHaveAttribute(
      'href',
      '/procurement/w2',
    );
  });
});

describe('QARelatedPairs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when relatedQA array is empty', () => {
    const { container } = render(<QARelatedPairs relatedQA={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders related items as links', () => {
    const relatedQA = [
      { id: 'q1', title: 'What is ISO 27001?' },
      { id: 'q2', title: 'How do we handle GDPR?' },
    ];
    render(<QARelatedPairs relatedQA={relatedQA} />);
    expect(screen.getByText('What is ISO 27001?').closest('a')).toHaveAttribute(
      'href',
      '/item/q1',
    );
    expect(
      screen.getByText('How do we handle GDPR?').closest('a'),
    ).toHaveAttribute('href', '/item/q2');
  });

  it('shows "Untitled" for null titles', () => {
    const relatedQA = [{ id: 'q1', title: null }];
    render(<QARelatedPairs relatedQA={relatedQA} />);
    expect(screen.getByText('Untitled')).toBeInTheDocument();
  });
});
