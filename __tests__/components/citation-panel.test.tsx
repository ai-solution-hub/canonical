/**
 * CitationPanel — defaultExpanded prop tests (P1-4)
 *
 * Verifies that the citation panel honours the `defaultExpanded` prop
 * for initial render state, while preserving manual toggle behaviour.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CitationPanel } from '@/components/content/citation-panel';
import type { CitationEntry } from '@/types/procurement-metadata';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCitation(overrides: Partial<CitationEntry> = {}): CitationEntry {
  return {
    source_id: 'src-1',
    source_title: 'Test Source',
    source_url: '/content/src-1',
    cited_text: 'Some cited passage from the knowledge base.',
    source_index: 0,
    start_block_index: 0,
    end_block_index: 1,
    ...overrides,
  };
}

function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'src-1',
    title: 'Test Source',
    content_type: 'article',
    primary_domain: 'construction',
    primary_subtopic: 'quality',
    summary: 'A summary of this source.',
    ...overrides,
  };
}

const defaultProps = {
  citations: [makeCitation()],
  sourceContent: [makeSource()],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CitationPanel defaultExpanded prop', () => {
  it('is collapsed by default when defaultExpanded is not provided', () => {
    render(<CitationPanel {...defaultProps} />);

    // The header button should indicate collapsed state
    const toggle = screen.getByRole('button', { expanded: false });
    expect(toggle).toBeInTheDocument();

    // Citation content should not be visible
    expect(screen.queryByText(/Some cited passage/)).not.toBeInTheDocument();
  });

  it('is collapsed when defaultExpanded={false}', () => {
    render(<CitationPanel {...defaultProps} defaultExpanded={false} />);

    const toggle = screen.getByRole('button', { expanded: false });
    expect(toggle).toBeInTheDocument();
    expect(screen.queryByText(/Some cited passage/)).not.toBeInTheDocument();
  });

  it('starts expanded when defaultExpanded={true}', () => {
    render(<CitationPanel {...defaultProps} defaultExpanded={true} />);

    const toggle = screen.getByRole('button', { expanded: true });
    expect(toggle).toBeInTheDocument();

    // Citation content should be visible immediately
    expect(screen.getByText(/Some cited passage/)).toBeInTheDocument();
  });

  it('shows orphan warnings immediately when expanded with orphaned sources', () => {
    const orphanedSourceIds = new Set(['src-1']);
    render(
      <CitationPanel
        {...defaultProps}
        defaultExpanded={true}
        orphanedSourceIds={orphanedSourceIds}
      />,
    );

    // Orphan badge should be visible without requiring manual expand
    expect(screen.getByText('Source removed')).toBeInTheDocument();
  });

  it('allows toggling closed after starting expanded', () => {
    render(<CitationPanel {...defaultProps} defaultExpanded={true} />);

    // Verify initially expanded
    expect(screen.getByText(/Some cited passage/)).toBeInTheDocument();

    // Click to collapse
    const toggle = screen.getByRole('button', { expanded: true });
    fireEvent.click(toggle);

    // Content should be hidden after collapse
    expect(screen.queryByText(/Some cited passage/)).not.toBeInTheDocument();
  });

  it('allows toggling open after starting collapsed', () => {
    render(<CitationPanel {...defaultProps} defaultExpanded={false} />);

    // Verify initially collapsed
    expect(screen.queryByText(/Some cited passage/)).not.toBeInTheDocument();

    // Click to expand
    const toggle = screen.getByRole('button', { expanded: false });
    fireEvent.click(toggle);

    // Content should now be visible
    expect(screen.getByText(/Some cited passage/)).toBeInTheDocument();
  });

  it('renders empty-state message when no citations exist (ignores defaultExpanded)', () => {
    render(
      <CitationPanel
        citations={[]}
        sourceContent={[]}
        defaultExpanded={true}
      />,
    );

    // Should show the no-citations message regardless of defaultExpanded
    expect(
      screen.getByText(/No citations — this response was not sourced/),
    ).toBeInTheDocument();
  });
});
