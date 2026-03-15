/**
 * KBSearchResults Component Tests
 *
 * Tests empty state, result count, title links, content type badges,
 * and similarity percentage display.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { KBSearchResults } from '@/components/copilot-ui/kb-search-results';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createResult(overrides: Partial<{
  id: string;
  title: string;
  type: string;
  domain: string;
  similarity: number;
  summary: string;
}> = {}) {
  return {
    id: overrides.id ?? 'result-1',
    title: overrides.title ?? 'Test Article',
    type: overrides.type,
    domain: overrides.domain,
    similarity: overrides.similarity,
    summary: overrides.summary,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KBSearchResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "No matching content found" when results are empty', () => {
    render(<KBSearchResults results={[]} />);

    expect(
      screen.getByText(/No matching content found/),
    ).toBeInTheDocument();
  });

  it('shows result count', () => {
    const results = [
      createResult({ id: '1', title: 'First' }),
      createResult({ id: '2', title: 'Second' }),
    ];

    render(<KBSearchResults results={results} />);

    expect(screen.getByText('2 results found')).toBeInTheDocument();
  });

  it('renders result titles as links to item pages', () => {
    const results = [createResult({ id: 'abc-123', title: 'My Article' })];

    render(<KBSearchResults results={results} />);

    const link = screen.getByText('My Article').closest('a');
    expect(link).toHaveAttribute('href', '/item/abc-123');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows content type badges', () => {
    const results = [createResult({ type: 'case_study' })];

    render(<KBSearchResults results={results} />);

    expect(screen.getByText('case study')).toBeInTheDocument();
  });

  it('shows similarity percentage', () => {
    const results = [createResult({ similarity: 0.87 })];

    render(<KBSearchResults results={results} />);

    expect(screen.getByText('87% match')).toBeInTheDocument();
  });
});
