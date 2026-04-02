/**
 * ContentRenderer Component Tests
 *
 * Tests the ContentRenderer component — plain text rendering,
 * markdown detection and rendering, and heading id slugification.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { ContentRenderer } from '@/components/item-detail/content-renderer';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders plain text as paragraphs when no markdown is detected', () => {
    const text = 'First paragraph\n\nSecond paragraph';
    render(<ContentRenderer content={text} />);
    expect(screen.getByText('First paragraph')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph')).toBeInTheDocument();
  });

  it('renders markdown through react-markdown when detected', () => {
    const md = '## Hello World\n\nSome text here.';
    render(<ContentRenderer content={md} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('detects headings as markdown', () => {
    const md = '# Top Heading\n\nBody text.';
    render(<ContentRenderer content={md} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('detects links as markdown', () => {
    const md = 'Visit [our site](https://example.com) for details.';
    render(<ContentRenderer content={md} />);
    const link = screen.getByRole('link', { name: 'our site' });
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('detects lists as markdown', () => {
    const md = '- Item one\n- Item two\n- Item three';
    render(<ContentRenderer content={md} />);
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(3);
  });

  it('adds slugified ids to headings', () => {
    const md = '## Data Security\n\nContent here.\n\n## Cloud Infrastructure';
    render(<ContentRenderer content={md} />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings[0]).toHaveAttribute('id', 'data-security');
    expect(headings[1]).toHaveAttribute('id', 'cloud-infrastructure');
  });
});
