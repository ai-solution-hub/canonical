/**
 * VersionDiff Component Tests
 *
 * Tests word-level diff display including identical texts,
 * added/removed highlighting, aria labels, and region role.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('diff', () => ({
  diffWords: (oldText: string, newText: string) => {
    // Simple mock: if texts are identical return single unchanged part,
    // otherwise return removed old + added new
    if (oldText === newText) {
      return [{ value: oldText, added: false, removed: false }];
    }
    return [
      { value: oldText, added: false, removed: true },
      { value: newText, added: true, removed: false },
    ];
  },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { VersionDiff } from '@/components/version-diff';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VersionDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "No differences" when texts are identical', () => {
    render(<VersionDiff oldText="Hello world" newText="Hello world" />);

    expect(screen.getByText('No differences')).toBeInTheDocument();
  });

  it('shows added text with appropriate aria-label', () => {
    render(<VersionDiff oldText="old text" newText="new text" />);

    const addedSpan = screen.getByLabelText('Added: new text');
    expect(addedSpan).toBeInTheDocument();
    expect(addedSpan).toHaveTextContent('new text');
  });

  it('shows removed text with appropriate aria-label', () => {
    render(<VersionDiff oldText="old text" newText="new text" />);

    const removedSpan = screen.getByLabelText('Removed: old text');
    expect(removedSpan).toBeInTheDocument();
    expect(removedSpan).toHaveTextContent('old text');
  });

  it('has aria-label on diff regions for added text', () => {
    render(<VersionDiff oldText="before" newText="after" />);

    expect(screen.getByLabelText('Added: after')).toBeInTheDocument();
    expect(screen.getByLabelText('Removed: before')).toBeInTheDocument();
  });

  it('wraps diff output in a region with aria-label', () => {
    render(<VersionDiff oldText="a" newText="b" />);

    expect(
      screen.getByRole('region', { name: 'Content differences' }),
    ).toBeInTheDocument();
  });
});
