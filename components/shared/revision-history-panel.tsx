'use client';

import type { ReactNode } from 'react';
import { History, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface RevisionHistoryPanelProps {
  /** Uppercase section label rendered in the toggle (its accessible name). */
  title: string;
  /** Whether the body is expanded. The consumer owns this state so any
   *  `useQuery({ enabled: isOpen })` leg stays driven by the same flag. */
  isOpen: boolean;
  /** Toggle handler invoked when the header button is clicked. */
  onToggle: () => void;
  /** Optional revision count; renders a secondary Badge when > 0. */
  total?: number;
  className?: string;
  /** Extra classes for the `isOpen`-gated body wrapper (e.g. padding). */
  bodyClassName?: string;
  /** Body content, rendered only while `isOpen`. */
  children: ReactNode;
}

/**
 * RevisionHistoryPanel — the shared collapsible-panel CHROME extracted from the
 * content (`components/item-detail/version-history.tsx`) and Q&A
 * (`components/qa/qa-revision-history.tsx`) revision surfaces (CMP-7 dedup).
 *
 * Owns only the panel shell: the rounded border, the History-icon header with
 * its uppercase title + optional total Badge + chevron toggle (`aria-expanded`),
 * and the `isOpen`-gated `border-t` body. The consumer keeps its own `isOpen`
 * state and supplies the body as children, so each surface's data-fetching legs
 * and diff rendering are untouched.
 */
export function RevisionHistoryPanel({
  title,
  isOpen,
  onToggle,
  total,
  className,
  bodyClassName,
  children,
}: RevisionHistoryPanelProps) {
  return (
    <div className={cn('rounded-lg border', className)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
          {total != null && total > 0 && (
            <Badge variant="secondary" className="text-[11px]">
              {total}
            </Badge>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className={cn('border-t border-border', bodyClassName)}>
          {children}
        </div>
      )}
    </div>
  );
}
