import type { ReactNode } from 'react';

/**
 * Highlight matching query terms in text by wrapping them in <mark> elements.
 * Returns an array of React nodes (strings and JSX elements).
 *
 * Terms shorter than 2 characters are ignored to avoid noisy matches.
 * The `bg-highlight-mark` class is defined in globals.css for light/dark themes.
 */
export function highlightTerms(text: string, query: string): ReactNode[] {
  if (!query.trim()) return [text];

  // Split query into unique words (min 2 chars to avoid highlighting noise)
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (terms.length === 0) return [text];

  // Use a capturing group so split keeps the matched delimiters
  const pattern = new RegExp(`(${terms.join('|')})`, 'gi');
  const parts = text.split(pattern);

  // A non-global regex to test whether a part is a matched term
  const testPattern = new RegExp(`^(?:${terms.join('|')})$`, 'i');

  return parts.map((part, i) => {
    if (testPattern.test(part)) {
      return (
        <mark
          key={i}
          className="bg-highlight-mark rounded px-0.5 text-foreground"
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}
