'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * Collapsible section with chevron trigger for grouping item detail regions.
 */
export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  className,
  contentClassName,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
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
      {isOpen && <div className={contentClassName}>{children}</div>}
    </div>
  );
}
