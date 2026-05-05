'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (window.innerWidth < 768) {
      setIsCollapsed(true); // eslint-disable-line react-hooks/set-state-in-effect -- SSR-safe: initialise from window on mount to avoid hydration mismatch
    }
  }, []);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Set up IntersectionObserver to track active heading
  useEffect(() => {
    if (entries.length < minHeadings) return;

    // Clean up previous observer
    observerRef.current?.disconnect();

    const headingElements = entries
      .map((entry) => document.getElementById(entry.id))
      .filter(Boolean) as HTMLElement[];

    if (headingElements.length === 0) return;

    const observer = new IntersectionObserver(
      (intersections) => {
        // Find the first visible heading (topmost in viewport)
        const visible = intersections
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0,
      },
    );

    headingElements.forEach((el) => observer.observe(el));
    observerRef.current = observer;

    return () => observer.disconnect();
  }, [entries, minHeadings]);

  const handleScrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleBackToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Don't render if not enough headings
  if (entries.length < minHeadings) {
    return null;
  }

  return (
    <nav
      aria-label="Table of contents"
      className={cn('rounded-md border bg-muted/20 p-3', className)}
    >
      <button
        type="button"
        onClick={() => setIsCollapsed((prev) => !prev)}
        className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {isCollapsed ? (
          <ChevronRight className="size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" />
        )}
        Contents
      </button>

      {!isCollapsed && (
        <ul className="mt-2 flex flex-col gap-0.5">
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
          <li className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              onClick={handleBackToTop}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <ArrowUp className="size-3" />
              Back to top
            </button>
          </li>
        </ul>
      )}
    </nav>
  );
}
