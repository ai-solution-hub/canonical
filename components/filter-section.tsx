'use client';

import { useState, useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface FilterSectionProps {
  title: string;
  children: ReactNode;
  /** Whether the section starts expanded (defaults to true) */
  defaultOpen?: boolean;
}

/** Collapsible section wrapper for filter groups */
export function FilterSection({ title, children, defaultOpen = true }: FilterSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className="mb-2 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        {title}
        <ChevronDown
          className={`size-3.5 motion-safe:transition-transform ${isOpen ? '' : '-rotate-90'}`}
          aria-hidden="true"
        />
      </button>
      <div
        id={contentId}
        role="group"
        aria-label={title}
        aria-hidden={!isOpen}
        className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-200 ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className={`overflow-hidden${!isOpen ? ' invisible' : ''}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
