'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ArrowUp, List } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Smooth-scroll a heading/section element into view by id. */
export function scrollToId(id: string): void {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TocNavProps {
  /** Accessible name for the surrounding `<nav>` landmark. */
  ariaLabel: string;
  /** Label shown next to the collapse chevron (e.g. "Sections", "Contents"). */
  toggleLabel: string;
  /** Show the list icon before the toggle label (guide ToC chrome). */
  showListIcon?: boolean;
  /** Rendered entry rows — each caller derives these from its own data. */
  children: ReactNode;
  /** Wrap entry rows + back-to-top in an `<ol>` (with list role) instead of `<ul>`. */
  ordered?: boolean;
  /**
   * Base classes for the `<nav>` container. Defaults to the item-detail ToC
   * surface; the guide ToC overrides with its own card styling.
   */
  navClassName?: string;
  /** Caller-supplied extra classes, merged last. */
  className?: string;
}

/**
 * Presentational shell shared by the guide and item-detail tables of contents:
 * the collapse toggle, the `<nav>` landmark, the list wrapper, and the
 * back-to-top control. Callers own active-heading tracking (see
 * `useActiveHeading`) and entry-row derivation, passing the rendered rows as
 * children.
 */
export function TocNav({
  ariaLabel,
  toggleLabel,
  showListIcon = false,
  children,
  ordered = false,
  navClassName = 'rounded-md border bg-muted/20 p-3',
  className,
}: TocNavProps) {
  // Initialise collapsed state from viewport width (mobile = collapsed).
  // Lazy initialiser is SSR-safe and avoids a hydration mismatch.
  const [isCollapsed, setIsCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );

  const handleBackToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const backToTop = (
    <li className="mt-1 border-t border-border pt-1">
      <button
        type="button"
        onClick={handleBackToTop}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <ArrowUp className="size-3" aria-hidden="true" />
        Back to top
      </button>
    </li>
  );

  const ListTag = ordered ? 'ol' : 'ul';

  return (
    <nav aria-label={ariaLabel} className={cn(navClassName, className)}>
      <button
        type="button"
        onClick={() => setIsCollapsed((prev) => !prev)}
        className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        {isCollapsed ? (
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        {showListIcon && (
          <List className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        {toggleLabel}
      </button>

      {!isCollapsed && (
        <ListTag
          className="mt-2 flex flex-col gap-0.5"
          {...(ordered ? { role: 'list' } : {})}
        >
          {children}
          {backToTop}
        </ListTag>
      )}
    </nav>
  );
}
