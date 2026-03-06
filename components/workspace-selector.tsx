'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Check, ChevronsUpDown, Plus, X, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Workspace } from '@/types/content';

interface WorkspaceSelectorProps {
  itemId: string;
  className?: string;
}

export function WorkspaceSelector({ itemId, className }: WorkspaceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const [itemWorkspaces, setItemWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch workspaces when popover opens
  useEffect(() => {
    if (!open) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [allRes, itemRes] = await Promise.all([
          fetch('/api/workspaces'),
          fetch(`/api/items/${itemId}/projects`),
        ]);
        if (allRes.ok) setAllWorkspaces(await allRes.json());
        if (itemRes.ok) setItemWorkspaces(await itemRes.json());
      } catch {
        toast.error('Failed to load workspaces');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [open, itemId]);

  const isAssigned = useCallback(
    (workspaceId: string) => itemWorkspaces.some((p) => p.id === workspaceId),
    [itemWorkspaces],
  );

  const handleToggle = useCallback(
    async (workspace: Workspace) => {
      const assigned = isAssigned(workspace.id);
      const action = assigned ? 'unassign' : 'assign';

      // Optimistic update
      if (assigned) {
        setItemWorkspaces((prev) => prev.filter((p) => p.id !== workspace.id));
      } else {
        setItemWorkspaces((prev) => [...prev, workspace]);
      }

      try {
        const res = await fetch(`/api/items/${itemId}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: workspace.id, action }),
        });
        if (!res.ok) throw new Error();
        toast(assigned ? `Removed from ${workspace.name}` : `Added to ${workspace.name}`, {
          duration: 1500,
        });
      } catch {
        // Rollback
        if (assigned) {
          setItemWorkspaces((prev) => [...prev, workspace]);
        } else {
          setItemWorkspaces((prev) => prev.filter((p) => p.id !== workspace.id));
        }
        toast.error(`Failed to ${action} workspace`);
      }
    },
    [itemId, isAssigned],
  );

  const handleCreate = useCallback(async () => {
    if (!search.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/items/${itemId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ create: true, name: search.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create workspace');
      }
      const newWorkspace: Workspace = await res.json();
      setAllWorkspaces((prev) => [...prev, newWorkspace].sort((a, b) => a.name.localeCompare(b.name)));
      setItemWorkspaces((prev) => [...prev, newWorkspace]);
      setSearch('');
      toast(`Created and assigned "${newWorkspace.name}"`, { duration: 2000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setCreating(false);
    }
  }, [search, itemId]);

  const filtered = allWorkspaces.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );
  const showCreateOption =
    search.trim() &&
    !allWorkspaces.some(
      (p) => p.name.toLowerCase() === search.trim().toLowerCase(),
    );

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Workspaces
      </h2>

      {/* Assigned workspace badges */}
      {itemWorkspaces.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {itemWorkspaces.map((workspace) => (
            <span
              key={workspace.id}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: workspace.color }}
              />
              {workspace.name}
              <button
                onClick={() => handleToggle(workspace)}
                className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-foreground/10"
                aria-label={`Remove from ${workspace.name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-fit gap-1.5 border-dashed text-xs text-muted-foreground"
          >
            <FolderOpen className="size-3.5" />
            {itemWorkspaces.length === 0 ? 'Add to workspace' : 'Manage workspaces'}
            <ChevronsUpDown className="size-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <Input
            ref={inputRef}
            placeholder="Search or create workspace..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && showCreateOption) {
                e.preventDefault();
                handleCreate();
              }
            }}
            className="mb-2 h-8 text-sm"
          />
          <div className="max-h-48 overflow-y-auto">
            {loading ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                Loading...
              </p>
            ) : (
              <>
                {filtered.map((workspace) => {
                  const assigned = isAssigned(workspace.id);
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => handleToggle(workspace)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                    >
                      <Check
                        className={cn(
                          'size-3.5 shrink-0',
                          assigned ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: workspace.color }}
                      />
                      <span className="truncate">{workspace.name}</span>
                    </button>
                  );
                })}
                {showCreateOption && (
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-primary transition-colors hover:bg-accent"
                  >
                    <Plus className="size-3.5 shrink-0" />
                    <span className="truncate">
                      Create &ldquo;{search.trim()}&rdquo;
                    </span>
                  </button>
                )}
                {filtered.length === 0 && !showCreateOption && (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No workspaces found
                  </p>
                )}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Small coloured badge for cards/rows */
export function WorkspaceBadge({
  name,
  color,
}: {
  name: string;
  color: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate max-w-[80px]">{name}</span>
    </span>
  );
}
