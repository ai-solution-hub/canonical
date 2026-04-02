'use client';

import { useState, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Tag,
  FolderOpen,
  Hash,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { WorkspaceSelector } from '@/components/workspace/workspace-selector';
import { UserTagInput } from '@/components/shared/user-tag-input';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { Workspace } from '@/types/content';

interface OrganiseSectionProps {
  itemId: string;
  keywords: string[];
  tags: string[];
  workspaces: Workspace[];
  canEdit: boolean;
  onKeywordsChanged: (keywords: string[]) => void;
  onTagsChanged: (tags: string[]) => void;
  onWorkspacesChanged: (workspaces: Workspace[]) => void;
  className?: string;
}

export function OrganiseSection({
  itemId,
  keywords,
  tags,
  workspaces,
  canEdit,
  onKeywordsChanged,
  onTagsChanged,
  className,
}: OrganiseSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const handleExpand = useCallback(() => {
    setExpanded(true);
  }, []);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const allEmpty =
    keywords.length === 0 && tags.length === 0 && workspaces.length === 0;

  // When canEdit=false AND all arrays empty: render null
  if (!canEdit && allEmpty) {
    return null;
  }

  const hasKeywords = keywords.length > 0;
  const hasTags = tags.length > 0;
  const hasWorkspaces = workspaces.length > 0;

  // Build the inline "Add" links for empty categories
  const emptyCategories: {
    label: string;
    icon: React.ReactNode;
    key: string;
  }[] = [];
  if (!hasKeywords) {
    emptyCategories.push({
      label: 'Add keywords',
      icon: <Hash className="size-3" />,
      key: 'keywords',
    });
  }
  if (!hasWorkspaces) {
    emptyCategories.push({
      label: 'Assign to...',
      icon: <FolderOpen className="size-3" />,
      key: 'workspaces',
    });
  }
  if (!hasTags) {
    emptyCategories.push({
      label: 'Add tags',
      icon: <Tag className="size-3" />,
      key: 'tags',
    });
  }

  // All empty AND canEdit: show single collapsed row
  if (allEmpty && !expanded) {
    return (
      <section className={cn('border-t border-border pt-4', className)}>
        <button
          type="button"
          onClick={handleToggle}
          className="flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className="size-3.5 shrink-0" />
          <span className="font-medium">Organise</span>
          <span className="flex items-center gap-3 text-xs">
            {emptyCategories.map((cat, i) => (
              <span key={cat.key} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-border">|</span>}
                <span
                  className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExpand();
                  }}
                >
                  {cat.icon}
                  {cat.label}
                </span>
              </span>
            ))}
          </span>
        </button>
      </section>
    );
  }

  // Partially populated or expanded: show populated categories + collapse empty to links
  return (
    <section className={cn('border-t border-border pt-4', className)}>
      <button
        type="button"
        onClick={handleToggle}
        className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
        Organise
      </button>

      {/* Keywords — show if populated or expanded */}
      {(hasKeywords || expanded) && (
        <KeywordsRow
          itemId={itemId}
          keywords={keywords}
          canEdit={canEdit}
          onKeywordsChanged={onKeywordsChanged}
        />
      )}

      {/* Workspaces — show if populated or expanded */}
      {(hasWorkspaces || expanded) && (
        <div className="mb-3">
          <WorkspaceSelector itemId={itemId} className="" />
        </div>
      )}

      {/* Tags — show if populated or expanded */}
      {(hasTags || expanded) && (
        <div className="mb-3">
          <UserTagInput
            itemId={itemId}
            tags={tags}
            onTagsChanged={onTagsChanged}
          />
        </div>
      )}

      {/* Inline "Add" links for still-empty categories when not fully expanded */}
      {!expanded && emptyCategories.length > 0 && canEdit && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {emptyCategories.map((cat, i) => (
            <span key={cat.key} className="inline-flex items-center gap-1">
              {i > 0 && <span className="text-border">|</span>}
              <button
                type="button"
                onClick={handleExpand}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Plus className="size-3" />
                {cat.label}
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Internal keywords row (mirrors the pattern from item-detail-client.tsx)
// ---------------------------------------------------------------------------

function KeywordsRow({
  itemId,
  keywords,
  canEdit,
  onKeywordsChanged,
}: {
  itemId: string;
  keywords: string[];
  canEdit: boolean;
  onKeywordsChanged: (keywords: string[]) => void;
}) {
  const handleRemove = useCallback(
    async (keyword: string) => {
      const updated = keywords.filter((k) => k !== keyword);
      onKeywordsChanged(updated);

      try {
        const res = await fetch(`/api/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field: 'ai_keywords', value: updated }),
        });
        if (!res.ok) throw new Error();
      } catch (err) {
        console.error('Failed to remove keyword:', err);
        // Rollback handled by parent
        onKeywordsChanged(keywords);
      }
    },
    [itemId, keywords, onKeywordsChanged],
  );

  const handleAdd = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = (e.target as HTMLInputElement).value.trim();
        if (!val) return;
        if (keywords.includes(val)) return;
        const updated = [...keywords, val];
        onKeywordsChanged(updated);
        (e.target as HTMLInputElement).value = '';

        try {
          const res = await fetch(`/api/items/${itemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field: 'ai_keywords', value: updated }),
          });
          if (!res.ok) throw new Error();
        } catch (err) {
          console.error('Failed to add keyword:', err);
          onKeywordsChanged(keywords);
        }
      }
    },
    [itemId, keywords, onKeywordsChanged],
  );

  return (
    <div className="mb-3">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Keywords
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {keywords.map((keyword) => (
          <Badge
            key={keyword}
            variant="secondary"
            className="group/kw gap-1 pr-1"
          >
            <Link
              href={`/browse?keywords=${encodeURIComponent(keyword)}`}
              className="hover:underline"
            >
              {keyword}
            </Link>
            {canEdit && (
              <button
                onClick={() => handleRemove(keyword)}
                className="rounded-full p-0.5 opacity-100 transition-opacity hover:bg-foreground/10 sm:opacity-0 sm:group-hover/kw:opacity-100 sm:group-focus-within/kw:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${keyword}`}
              >
                <X className="size-3" />
              </button>
            )}
          </Badge>
        ))}
        {canEdit && (
          <Input
            placeholder="Add keyword..."
            onKeyDown={handleAdd}
            className="h-6 w-28 border-dashed text-xs"
          />
        )}
      </div>
    </div>
  );
}
