/**
 * DiffHighlightedText — design-system contract test.
 *
 * Single intentional coupling point between the diff <mark> elements and the
 * Warm Meridian semantic colour tokens. The behaviour suite
 * (diff-highlighted-text.test.tsx) asserts the observable diff behaviour
 * (added/removed marks with accessible labels, strikethrough on removals);
 * this file alone pins the added/removed → semantic-token mapping.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DiffHighlightedText } from '@/components/source-document/diff-highlighted-text';

describe('DiffHighlightedText — semantic token contract', () => {
  it('maps added text to its semantic colour tokens', () => {
    const { container } = render(
      <DiffHighlightedText oldText="Hello" newText="Hello world" side="new" />,
    );
    const addedMark = container.querySelector('mark[aria-label="Added text"]');
    expect(addedMark).toBeTruthy();
    expect(addedMark!.className).toContain('bg-quality-good-bg');
    expect(addedMark!.className).toContain('text-quality-good');
  });

  it('maps removed text to its semantic colour tokens', () => {
    const { container } = render(
      <DiffHighlightedText oldText="Hello world" newText="Hello" side="old" />,
    );
    const removedMark = container.querySelector(
      'mark[aria-label="Removed text"]',
    );
    expect(removedMark).toBeTruthy();
    expect(removedMark!.className).toContain('bg-destructive/10');
    expect(removedMark!.className).toContain('text-destructive');
  });
});
