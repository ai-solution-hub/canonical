'use client';

import { useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useActiveHeading } from '@/hooks/use-active-heading';
import { TocNav, scrollToId } from '@/components/shared/toc-nav';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuideTocSection {
  section_id: string;
  section_name: string;
  is_required: boolean;
  has_content: boolean;
}

interface GuideTableOfContentsProps {
  sections: GuideTocSection[];
  /** Minimum number of sections before ToC is shown (default: 3) */
  minSections?: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GuideTableOfContents({
  sections,
  minSections = 3,
  className,
}: GuideTableOfContentsProps) {
  const ids = useMemo(() => sections.map((s) => s.section_id), [sections]);
  const activeId = useActiveHeading(ids, minSections);

  const handleScrollTo = useCallback((id: string) => scrollToId(id), []);

  // Don't render if not enough sections
  if (sections.length < minSections) {
    return null;
  }

  return (
    <TocNav
      ariaLabel="Guide sections"
      toggleLabel="Sections"
      showListIcon
      ordered
      navClassName="rounded-lg border bg-card p-4"
      className={className}
    >
      {sections.map((section, index) => (
        <li key={section.section_id}>
          <a
            href={`#${section.section_id}`}
            onClick={(e) => {
              e.preventDefault();
              handleScrollTo(section.section_id);
            }}
            className={cn(
              'flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
              activeId === section.section_id
                ? 'bg-accent/50 font-medium text-foreground'
                : 'text-muted-foreground',
            )}
          >
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {index + 1}.
            </span>
            <span className="min-w-0 truncate">{section.section_name}</span>
            {!section.has_content && section.is_required && (
              <span
                className="ml-auto size-1.5 shrink-0 rounded-full bg-destructive"
                title="Required section — no content yet"
                aria-label="Required section with no content"
              />
            )}
            {section.has_content && (
              <span
                className="ml-auto size-1.5 shrink-0 rounded-full bg-freshness-fresh"
                title="Section has content"
                aria-label="Section has content"
              />
            )}
          </a>
        </li>
      ))}
    </TocNav>
  );
}
