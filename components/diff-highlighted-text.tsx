'use client';

import { useMemo } from 'react';
import { diffWords, type Change } from 'diff';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffHighlightedTextProps {
  oldText: string;
  newText: string;
  side: 'old' | 'new';
}

// ---------------------------------------------------------------------------
// Constants — character thresholds for lazy diff computation
// ---------------------------------------------------------------------------

/** Desktop threshold: defer diff for texts longer than this */
const DESKTOP_CHAR_THRESHOLD = 5000;

/** Mobile threshold: defer diff for texts longer than this */
const MOBILE_CHAR_THRESHOLD = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether the combined text length exceeds the threshold for the
 * current viewport. Uses a simple width check rather than a media query
 * hook — this is only evaluated once per render, not reactive to resize.
 */
export function exceedsLazyThreshold(oldText: string, newText: string): boolean {
  const maxLen = Math.max(oldText.length, newText.length);
  // SSR-safe: default to desktop threshold when window is unavailable
  const isMobile =
    typeof window !== 'undefined' && window.innerWidth < 768;
  const threshold = isMobile ? MOBILE_CHAR_THRESHOLD : DESKTOP_CHAR_THRESHOLD;
  return maxLen > threshold;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders inline word-level diff highlighting for a pair of old/new texts.
 *
 * On the "old" side, removed words are shown with red background + strikethrough.
 * On the "new" side, added words are shown with green background.
 * Unchanged text renders normally.
 *
 * Uses `<mark>` elements with appropriate `aria-label` for accessibility.
 */
export function DiffHighlightedText({
  oldText,
  newText,
  side,
}: DiffHighlightedTextProps) {
  const changes: Change[] = useMemo(
    () => diffWords(oldText, newText),
    [oldText, newText],
  );

  return (
    <span>
      {changes.map((change, index) => {
        // On the "old" side, show removed words highlighted; skip added words
        if (side === 'old') {
          if (change.added) return null;
          if (change.removed) {
            return (
              <mark
                key={index}
                className="bg-destructive/10 text-destructive line-through rounded-sm px-0.5"
                aria-label="Removed text"
              >
                {change.value}
              </mark>
            );
          }
          // Unchanged
          return <span key={index}>{change.value}</span>;
        }

        // On the "new" side, show added words highlighted; skip removed words
        if (change.removed) return null;
        if (change.added) {
          return (
            <mark
              key={index}
              className="bg-quality-good-bg text-quality-good rounded-sm px-0.5"
              aria-label="Added text"
            >
              {change.value}
            </mark>
          );
        }
        // Unchanged
        return <span key={index}>{change.value}</span>;
      })}
    </span>
  );
}
