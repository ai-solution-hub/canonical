'use client';

import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContentTemplate } from '@/lib/content/content-templates';

export interface TemplateSelectorProps {
  templates: ContentTemplate[];
  selectedId?: string;
  onSelect: (template: ContentTemplate | null) => void;
  className?: string;
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
}: TemplateSelectorProps) {
  const isBlankSelected = !selectedId;

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-sm font-medium text-foreground" id="template-selector-label">
        Start from a template
      </p>
      <div
        role="radiogroup"
        aria-labelledby="template-selector-label"
        className="flex gap-3 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible"
      >
        {/* Blank option */}
        <button
          type="button"
          role="radio"
          aria-checked={isBlankSelected}
          onClick={() => onSelect(null)}
          className={cn(
            'flex min-w-[140px] shrink-0 cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
            'hover:border-primary/50 hover:bg-accent/50',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isBlankSelected
              ? 'border-primary bg-primary/5'
              : 'border-border bg-card',
          )}
        >
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-medium text-foreground">Blank</span>
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
              className={cn(
                'flex min-w-[140px] shrink-0 cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                'hover:border-primary/50 hover:bg-accent/50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card',
              )}
            >
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
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
