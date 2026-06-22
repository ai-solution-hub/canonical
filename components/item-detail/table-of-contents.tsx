'use client';

import { useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useActiveHeading } from '@/hooks/use-active-heading';
import { TocNav, scrollToId } from '@/components/shared/toc-nav';

/** @public */
export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  /** Markdown content to extract headings from */
  content: string;
  /** Minimum number of headings before ToC is shown (default: 3) */
  minHeadings?: number;
  className?: string;
}

/**
 * Slugify a heading string into a URL-safe id.
 * Lowercase, replace spaces and punctuation with hyphens, strip special chars.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parse ## H2 and ### H3 headings from markdown content.
 * Handles duplicate headings by appending -2, -3 etc.
 */
function parseHeadings(content: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const idCounts = new Map<string, number>();
  // Match lines starting with ## or ### (not # or ####+)
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const baseId = slugify(text);

    // Handle duplicates
    const count = idCounts.get(baseId) ?? 0;
    idCounts.set(baseId, count + 1);
    const id = count === 0 ? baseId : `${baseId}-${count + 1}`;

    entries.push({ id, text, level });
  }

  return entries;
}

export function TableOfContents({
  content,
  minHeadings = 3,
  className,
}: TableOfContentsProps) {
  const entries = useMemo(() => parseHeadings(content), [content]);
  const ids = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const activeId = useActiveHeading(ids, minHeadings);

  const handleScrollTo = useCallback((id: string) => scrollToId(id), []);

  // Don't render if not enough headings
  if (entries.length < minHeadings) {
    return null;
  }

  return (
    <TocNav
      ariaLabel="Table of contents"
      toggleLabel="Contents"
      className={className}
    >
      {entries.map((entry) => (
        <li
          key={entry.id}
          style={{
            paddingLeft: entry.level === 3 ? '1rem' : '0',
          }}
        >
          <a
            href={`#${entry.id}`}
            onClick={(e) => {
              e.preventDefault();
              handleScrollTo(entry.id);
            }}
            className={cn(
              'block rounded px-2 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
              activeId === entry.id
                ? 'bg-accent/50 font-medium text-foreground'
                : 'text-muted-foreground',
            )}
          >
            {entry.text}
          </a>
        </li>
      ))}
    </TocNav>
  );
}
