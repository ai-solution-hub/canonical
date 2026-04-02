'use client';

import { useState } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DomainTagGroup {
  domain: string;
  tags: { tag: string; count: number }[];
}

interface TagDomainViewProps {
  groups: DomainTagGroup[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Tags grouped by domain with expand/collapse sections.
 * Each domain shows its tags sorted by count descending.
 */
export function TagDomainView({ groups }: TagDomainViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Expand first 3 domains by default
    return new Set(groups.slice(0, 3).map((g) => g.domain));
  });

  const toggleDomain = (domain: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpanded(new Set(groups.map((g) => g.domain)));
  };

  const collapseAll = () => {
    setExpanded(new Set());
  };

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <Layers
          className="size-8 text-muted-foreground/50"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">
          No tags found grouped by domain.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={expandAll}
        >
          Expand all
        </button>
        <span className="text-xs text-muted-foreground">/</span>
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={collapseAll}
        >
          Collapse all
        </button>
      </div>

      {/* Domain sections */}
      <div className="divide-y divide-border rounded-md border">
        {groups.map((group) => {
          const isExpanded = expanded.has(group.domain);
          const totalUsage = group.tags.reduce((sum, t) => sum + t.count, 0);

          return (
            <div key={group.domain}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50"
                onClick={() => toggleDomain(group.domain)}
                aria-expanded={isExpanded}
                aria-controls={`domain-tags-${group.domain}`}
              >
                <div className="flex items-center gap-2">
                  <ChevronDown
                    className={cn(
                      'size-4 text-muted-foreground transition-transform duration-200',
                      isExpanded && 'rotate-180',
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium">{group.domain}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {group.tags.length} tag{group.tags.length !== 1 ? 's' : ''}
                  </Badge>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {totalUsage} usage{totalUsage !== 1 ? 's' : ''}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div
                  id={`domain-tags-${group.domain}`}
                  className="px-4 pb-3"
                  role="region"
                  aria-label={`Tags in ${group.domain}`}
                >
                  <div className="flex flex-wrap gap-2">
                    {group.tags.map((t) => (
                      <Badge
                        key={t.tag}
                        variant="outline"
                        className={cn(
                          'text-xs',
                          t.count === 1 && 'text-tag-rare',
                        )}
                      >
                        {t.tag}
                        <span className="ml-1 tabular-nums text-muted-foreground">
                          ({t.count})
                        </span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
