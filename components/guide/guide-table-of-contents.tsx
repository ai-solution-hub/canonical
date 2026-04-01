'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, ArrowUp, List } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  const [activeId, setActiveId] = useState<string | null>(null);
  // Initialise collapsed state based on viewport width (mobile = collapsed)
  const [isCollapsed, setIsCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  const observerRef = useRef<IntersectionObserver | null>(null);

  // IntersectionObserver to track active section
  useEffect(() => {
    if (sections.length < minSections) return;

    observerRef.current?.disconnect();

    const sectionElements = sections
      .map((s) => document.getElementById(s.section_id))
      .filter(Boolean) as HTMLElement[];

    if (sectionElements.length === 0) return;

    const observer = new IntersectionObserver(
      (intersections) => {
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

    sectionElements.forEach((el) => observer.observe(el));
    observerRef.current = observer;

    return () => observer.disconnect();
  }, [sections, minSections]);

  const handleScrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleBackToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Don't render if not enough sections
  if (sections.length < minSections) {
    return null;
  }

  return (
    <nav
      aria-label="Guide sections"
      className={cn('rounded-lg border bg-card p-4', className)}
    >
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
        <List className="size-3.5 shrink-0" aria-hidden="true" />
        Sections
      </button>

      {!isCollapsed && (
        <ol className="mt-2 flex flex-col gap-0.5" role="list">
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
        </ol>
      )}
    </nav>
  );
}
