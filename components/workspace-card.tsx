'use client';

import Link from 'next/link';
import { Folder, Archive, ArchiveRestore, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ICON_MAP, type WorkspaceIconName } from '@/components/workspace-icon-picker';
import { formatRelativeDate } from '@/lib/format';
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

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Edit workspace: ${workspace.name}`}
      onClick={() => onEdit(workspace)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit(workspace);
        }
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none',
        workspace.is_archived && 'opacity-70',
      )}
      style={{ borderLeftWidth: '4px', borderLeftColor: workspace.color }}
    >
      <div className="flex flex-1 flex-col gap-2 p-4">
        {/* Header row: icon + name + item count */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon
              className="size-4 shrink-0 text-muted-foreground"
              style={{ color: workspace.color }}
            />
            <h3 className="truncate text-base font-semibold leading-tight">
              {workspace.name}
            </h3>
          </div>
          <Link
            href={`/browse?workspace=${workspace.id}`}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          >
            {workspace.item_count} {workspace.item_count === 1 ? 'item' : 'items'}
          </Link>
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
      </div>

      {/* Quick actions — hidden for read-only users */}
      {!readOnly && (
        <div className="flex items-center justify-end gap-1 border-t px-3 py-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <Button
            variant="ghost"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(workspace);
            }}
            className="gap-1 text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pencil className="size-3" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              onArchiveToggle(workspace);
            }}
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
  );
}
