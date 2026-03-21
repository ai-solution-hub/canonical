'use client';

import { useState, useId } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  lazy?: boolean;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * Collapsible section with chevron trigger for grouping item detail regions.
 *
 * By default, content is kept in the DOM with the `hidden` attribute when
 * collapsed (preserves state, focus position, scroll, etc.). Set `lazy` to
 * conditionally render instead (useful when children fetch data on mount).
 */
export function CollapsibleSection({
  title,
  defaultOpen = true,
  lazy = false,
  children,
  className,
  contentClassName,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const reactId = useId();
  const contentId = `collapsible-content-${reactId}`;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className="flex w-full items-center gap-2 py-2 text-left transition-colors hover:text-foreground"
      >
        {isOpen ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </button>
      {lazy ? (
        isOpen && <div id={contentId} className={contentClassName}>{children}</div>
      ) : (
        <div id={contentId} className={contentClassName} hidden={!isOpen}>{children}</div>
      )}
    </div>
  );
}
