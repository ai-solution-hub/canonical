import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DiffHighlightedText,
  exceedsLazyThreshold,
} from '@/components/source-document/diff-highlighted-text';

describe('DiffHighlightedText', () => {
  describe('new side — added words', () => {
    it('marks added words with aria-label="Added text"', () => {
      const { container } = render(
        <DiffHighlightedText
          oldText="The quick fox"
          newText="The quick brown fox"
          side="new"
        />,
      );

      const marks = container.querySelectorAll('mark');
      const addedMarks = Array.from(marks).filter(
        (m) => m.getAttribute('aria-label') === 'Added text',
      );
      expect(addedMarks.length).toBeGreaterThan(0);
      // The added word "brown" should be present
      const addedText = addedMarks.map((m) => m.textContent).join('');
      expect(addedText).toContain('brown');
    });

    it('does not show removed marks on the new side', () => {
      const { container } = render(
        <DiffHighlightedText
          oldText="The quick brown fox"
          newText="The quick fox"
          side="new"
        />,
      );

      const removedMarks = Array.from(
        container.querySelectorAll('mark'),
      ).filter((m) => m.getAttribute('aria-label') === 'Removed text');
      expect(removedMarks).toHaveLength(0);
    });
  });

  describe('old side — removed words', () => {
    it('marks removed words with aria-label="Removed text"', () => {
      const { container } = render(
        <DiffHighlightedText
          oldText="The quick brown fox"
          newText="The quick fox"
          side="old"
        />,
      );

      const marks = container.querySelectorAll('mark');
      const removedMarks = Array.from(marks).filter(
        (m) => m.getAttribute('aria-label') === 'Removed text',
      );
      expect(removedMarks.length).toBeGreaterThan(0);
      const removedText = removedMarks.map((m) => m.textContent).join('');
      expect(removedText).toContain('brown');
    });

    it('applies strikethrough class to removed text', () => {
      const { container } = render(
        <DiffHighlightedText
          oldText="Hello world"
          newText="Hello"
          side="old"
        />,
      );

      const removedMarks = Array.from(
        container.querySelectorAll('mark'),
      ).filter((m) => m.getAttribute('aria-label') === 'Removed text');
      expect(removedMarks.length).toBeGreaterThan(0);
      expect(removedMarks[0].className).toContain('line-through');
    });

    it('does not show added marks on the old side', () => {
      const { container } = render(
        <DiffHighlightedText
          oldText="The quick fox"
          newText="The quick brown fox"
          side="old"
        />,
      );

      const addedMarks = Array.from(
        container.querySelectorAll('mark'),
      ).filter((m) => m.getAttribute('aria-label') === 'Added text');
      expect(addedMarks).toHaveLength(0);
    });
  });

  describe('unchanged text', () => {
    it('renders unchanged text without marks', () => {
      const { container } = render(
        <DiffHighlightedText
          oldText="Hello world"
          newText="Hello world"
          side="new"
        />,
      );

      const marks = container.querySelectorAll('mark');
      expect(marks).toHaveLength(0);
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });
  });

  describe('empty strings', () => {
    it('produces no marks when both strings are empty', () => {
      const { container } = render(
        <DiffHighlightedText oldText="" newText="" side="new" />,
      );

      const marks = container.querySelectorAll('mark');
      expect(marks).toHaveLength(0);
    });

    it('produces no marks when both strings are empty (old side)', () => {
      const { container } = render(
        <DiffHighlightedText oldText="" newText="" side="old" />,
      );

      const marks = container.querySelectorAll('mark');
      expect(marks).toHaveLength(0);
    });
  });

  describe('identical strings', () => {
    it('produces no marks when strings are identical (new side)', () => {
      const { container } = render(
        <DiffHighlightedText
          oldText="Exactly the same content here"
          newText="Exactly the same content here"
          side="new"
        />,
      );

      const marks = container.querySelectorAll('mark');
      expect(marks).toHaveLength(0);
    });

    it('produces no marks when strings are identical (old side)', () => {
      const { container } = render(
        <DiffHighlightedText
          oldText="Exactly the same content here"
          newText="Exactly the same content here"
          side="old"
        />,
      );

      const marks = container.querySelectorAll('mark');
      expect(marks).toHaveLength(0);
    });
  });

  describe('semantic tokens', () => {
    it('uses semantic token classes for additions', () => {
      const { container } = render(
        <DiffHighlightedText
          oldText="Hello"
          newText="Hello world"
          side="new"
        />,
      );

      const addedMark = container.querySelector(
        'mark[aria-label="Added text"]',
      );
      expect(addedMark).toBeTruthy();
      expect(addedMark!.className).toContain('bg-quality-good-bg');
      expect(addedMark!.className).toContain('text-quality-good');
    });

    it('uses semantic token classes for removals', () => {
      const { container } = render(
        <DiffHighlightedText
          oldText="Hello world"
          newText="Hello"
          side="old"
        />,
      );

      const removedMark = container.querySelector(
        'mark[aria-label="Removed text"]',
      );
      expect(removedMark).toBeTruthy();
      expect(removedMark!.className).toContain('bg-destructive/10');
      expect(removedMark!.className).toContain('text-destructive');
    });
  });
});

describe('exceedsLazyThreshold', () => {
  it('returns false for short texts', () => {
    expect(exceedsLazyThreshold('short', 'text')).toBe(false);
  });

  it('returns true when text exceeds desktop threshold', () => {
    const longText = 'a'.repeat(5001);
    expect(exceedsLazyThreshold(longText, 'short')).toBe(true);
  });

  it('returns true when newText exceeds desktop threshold', () => {
    const longText = 'a'.repeat(5001);
    expect(exceedsLazyThreshold('short', longText)).toBe(true);
  });
});
