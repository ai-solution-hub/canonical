'use client';

import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContentTemplate } from '@/lib/content/content-templates';

/** @public */
export type TemplateSelectorLayout = 'compact' | 'fullwidth';

/** @public */
export interface TemplateSelectorProps {
  templates: ContentTemplate[];
  selectedId?: string;
  onSelect: (template: ContentTemplate | null) => void;
  className?: string;
  /** Display layout. 'compact' (default) shows a horizontal scroll / small grid.
   *  'fullwidth' renders a hero-style grid for the Write tab zero-state. */
  layout?: TemplateSelectorLayout;
}

/**
 * Displays content creation templates as clickable cards.
 * Includes a "Blank" option that clears the selection.
 * Keyboard navigable and WCAG 2.1 AA compliant.
 */
export function TemplateSelector({
  templates,
  selectedId,
  onSelect,
  className,
  layout = 'compact',
}: TemplateSelectorProps) {
  const isBlankSelected = !selectedId;
  const isFullwidth = layout === 'fullwidth';

  const blankLabel = isFullwidth ? 'Start from scratch' : 'Blank';
  const headingText = isFullwidth
    ? 'Choose a starting point'
    : 'Start from a template';

  const gridClassName = isFullwidth
    ? 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4'
    : 'flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible';

  const cardClassName = (isSelected: boolean) =>
    cn(
      'flex cursor-pointer flex-col items-start gap-1 rounded-lg border text-left transition-colors',
      'hover:border-primary/50 hover:bg-accent/50',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      isFullwidth ? 'p-4' : 'min-w-[140px] shrink-0 p-3',
      isSelected ? 'border-primary bg-primary/5' : 'border-border bg-card',
    );

  return (
    <div className={cn('space-y-2', className)}>
      <p
        className={cn(
          'font-medium text-foreground',
          isFullwidth ? 'text-base' : 'text-sm',
        )}
        id="template-selector-label"
      >
        {headingText}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="template-selector-label"
        className={gridClassName}
      >
        {/* Blank / Start from scratch option */}
        <button
          type="button"
          role="radio"
          aria-checked={isBlankSelected}
          onClick={() => onSelect(null)}
          className={cardClassName(isBlankSelected)}
        >
          <div className="flex items-center gap-2">
            <FileText
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-foreground">
              {blankLabel}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            Start with an empty form
          </span>
        </button>

        {/* Template cards */}
        {templates.map((template) => {
          const isSelected = selectedId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(template)}
              className={cardClassName(isSelected)}
            >
              <div className="flex items-center gap-2">
                <FileText
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="text-sm font-medium text-foreground">
                  {template.name}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {template.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
