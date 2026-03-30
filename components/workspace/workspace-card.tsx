'use client';

import Link from 'next/link';
import { Folder, Archive, ArchiveRestore, Pencil, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ICON_MAP, type WorkspaceIconName } from '@/components/workspace/workspace-icon-picker';
import { formatRelativeDate } from '@/lib/format';
import { getWorkspaceType } from '@/lib/workspace-types';
import { cn } from '@/lib/utils';
import type { Workspace } from '@/types/content';

export interface WorkspaceWithCounts extends Workspace {
  item_count: number;
  last_activity: string | null;
}

interface WorkspaceCardProps {
  workspace: WorkspaceWithCounts;
  onEdit: (workspace: WorkspaceWithCounts) => void;
  onArchiveToggle: (workspace: WorkspaceWithCounts) => void;
  readOnly?: boolean;
}

export function WorkspaceCard({
  workspace,
  onEdit,
  onArchiveToggle,
  readOnly = false,
}: WorkspaceCardProps) {
  const Icon = ICON_MAP[workspace.icon as WorkspaceIconName] ?? Folder;
  const typeConfig = getWorkspaceType(workspace.type);

  return (
    <div
      className={cn(
        'group relative grid grid-rows-[1fr_auto] rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md',
        workspace.is_archived && 'opacity-70',
      )}
      style={{
        borderLeftWidth: '4px',
        borderLeftColor: workspace.color || 'var(--border)',
      }}
    >
      <button
        type="button"
        onClick={() => onEdit(workspace)}
        className="flex flex-1 flex-col gap-2 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-t-lg"
        aria-label={`Open ${workspace.name}`}
      >
        {/* Header row: icon + name + type badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon
              className="size-4 shrink-0 text-muted-foreground"
              style={{ color: workspace.color }}
            />
            <h3 className="truncate text-base font-semibold leading-tight">
              {workspace.name}
            </h3>
            {typeConfig && (
              <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                {typeConfig.label}
              </Badge>
            )}
          </div>
          {typeConfig?.route && (
            <span title={`Opens ${typeConfig.label.toLowerCase()} detail page`}>
              <ArrowUpRight
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
          )}
        </div>

        {/* Description */}
        {workspace.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {workspace.description}
          </p>
        )}

        {/* Last activity */}
        <p className="mt-auto pt-1 text-xs text-muted-foreground">
          {workspace.last_activity
            ? `Last activity: ${formatRelativeDate(workspace.last_activity)}`
            : 'No items yet'}
        </p>
      </button>

      {/* Actions row: item count link + quick actions */}
      <div className="flex items-center justify-between gap-1 border-t px-3 py-2">
        <Link
          href={`/browse?workspace=${workspace.id}`}
          className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {workspace.item_count} {workspace.item_count === 1 ? 'item' : 'items'}
        </Link>
        {!readOnly && (
          <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onEdit(workspace)}
              className="gap-1 text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="size-3" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onArchiveToggle(workspace)}
              className="gap-1 text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {workspace.is_archived ? (
                <>
                  <ArchiveRestore className="size-3" />
                  Unarchive
                </>
              ) : (
                <>
                  <Archive className="size-3" />
                  Archive
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
