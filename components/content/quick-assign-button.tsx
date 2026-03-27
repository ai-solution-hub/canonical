'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FolderPlus, FolderCheck, Check, Zap } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ActiveBidWorkspace } from '@/hooks/use-quick-assign';

interface QuickAssignButtonProps {
  itemId: string;
  /** Pre-loaded active workspaces (from parent context) */
  activeWorkspaces: ActiveBidWorkspace[];
  /** Workspace IDs this item is currently assigned to */
  assignedWorkspaceIds: Set<string>;
  /** Callback when assignment changes (for optimistic parent update) */
  onAssignmentChange?: (itemId: string, workspaceId: string, workspaceName: string) => void;
  /** Workspace ID from ?from_bid= URL param for contextual quick-assign shortcut */
  fromBidId?: string;
  className?: string;
}

function formatDeadline(deadline: string | null): string | null {
  if (!deadline) return null;
  try {
    const date = new Date(deadline);
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return null;
  }
}

export function QuickAssignButton({
  itemId,
  activeWorkspaces,
  assignedWorkspaceIds,
  onAssignmentChange,
  fromBidId,
  className,
}: QuickAssignButtonProps) {
  const [open, setOpen] = useState(false);
  const isAssigned = assignedWorkspaceIds.size > 0;

  const assignedCount = assignedWorkspaceIds.size;
  const ariaLabel = isAssigned
    ? `Assigned to ${assignedCount} workspace${assignedCount !== 1 ? 's' : ''}`
    : 'Assign to workspace';

  // Build tooltip text for assigned workspaces
  const tooltipText = isAssigned
    ? activeWorkspaces
        .filter((ws) => assignedWorkspaceIds.has(ws.id))
        .map((ws) => ws.name)
        .join(', ')
    : undefined;

  // Resolve the from_bid workspace if it matches an active workspace
  const fromBidWorkspace = fromBidId
    ? activeWorkspaces.find((ws) => ws.id === fromBidId)
    : undefined;

  const handleToggle = (
    e: React.MouseEvent,
    workspace: ActiveBidWorkspace,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    onAssignmentChange?.(itemId, workspace.id, workspace.name);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          title={tooltipText}
          className={cn(
            'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1 transition-opacity',
            isAssigned
              ? 'text-primary opacity-100'
              : 'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100',
            className,
          )}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {isAssigned ? (
            <FolderCheck className="size-4" aria-hidden="true" />
          ) : (
            <FolderPlus className="size-4" aria-hidden="true" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-56 p-2"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
      >
        <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">
          Assign to workspace
        </p>

        {/* Quick-add shortcut when navigated from a specific bid */}
        {fromBidWorkspace && (
          <div className="mb-2">
            <button
              type="button"
              aria-label={`Quick add to ${fromBidWorkspace.name}`}
              className="flex w-full items-center gap-2 rounded-sm bg-primary/10 px-2 py-2 text-sm font-medium text-primary hover:bg-primary/20"
              onClick={(e) => handleToggle(e, fromBidWorkspace)}
            >
              <Zap className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">
                Quick add to {fromBidWorkspace.name}
              </span>
              {assignedWorkspaceIds.has(fromBidWorkspace.id) && (
                <Check className="size-3.5 shrink-0" aria-hidden="true" />
              )}
            </button>
            <div className="mx-2 mt-2 border-t border-border" />
          </div>
        )}

        {activeWorkspaces.length === 0 ? (
          <div className="px-2 py-3 text-center text-sm text-muted-foreground">
            <p>No active bids.</p>
            <Link
              href="/workspaces"
              className="mt-1 inline-block text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Create one in Workspaces
            </Link>
          </div>
        ) : (
          <div
            role="listbox"
            aria-label="Active bid workspaces"
            className="max-h-48 overflow-y-auto"
          >
            {activeWorkspaces.map((workspace) => {
              const isWsAssigned = assignedWorkspaceIds.has(workspace.id);
              const deadline = formatDeadline(workspace.deadline);

              return (
                <button
                  key={workspace.id}
                  type="button"
                  role="option"
                  aria-selected={isWsAssigned}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={(e) => handleToggle(e, workspace)}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: workspace.color }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {workspace.name}
                  </span>
                  {deadline && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {deadline}
                    </span>
                  )}
                  {isWsAssigned && (
                    <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
