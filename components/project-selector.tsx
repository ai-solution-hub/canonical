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
import type { Project } from '@/types/content';

interface ProjectSelectorProps {
  itemId: string;
  className?: string;
}

export function ProjectSelector({ itemId, className }: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [itemProjects, setItemProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch projects when popover opens
  useEffect(() => {
    if (!open) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [allRes, itemRes] = await Promise.all([
          fetch('/api/projects'),
          fetch(`/api/items/${itemId}/projects`),
        ]);
        if (allRes.ok) setAllProjects(await allRes.json());
        if (itemRes.ok) setItemProjects(await itemRes.json());
      } catch {
        toast.error('Failed to load projects');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [open, itemId]);

  const isAssigned = useCallback(
    (projectId: string) => itemProjects.some((p) => p.id === projectId),
    [itemProjects],
  );

  const handleToggle = useCallback(
    async (project: Project) => {
      const assigned = isAssigned(project.id);
      const action = assigned ? 'unassign' : 'assign';

      // Optimistic update
      if (assigned) {
        setItemProjects((prev) => prev.filter((p) => p.id !== project.id));
      } else {
        setItemProjects((prev) => [...prev, project]);
      }

      try {
        const res = await fetch(`/api/items/${itemId}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: project.id, action }),
        });
        if (!res.ok) throw new Error();
        toast(assigned ? `Removed from ${project.name}` : `Added to ${project.name}`, {
          duration: 1500,
        });
      } catch {
        // Rollback
        if (assigned) {
          setItemProjects((prev) => [...prev, project]);
        } else {
          setItemProjects((prev) => prev.filter((p) => p.id !== project.id));
        }
        toast.error(`Failed to ${action} project`);
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
        throw new Error(data.error || 'Failed to create project');
      }
      const newProject: Project = await res.json();
      setAllProjects((prev) => [...prev, newProject].sort((a, b) => a.name.localeCompare(b.name)));
      setItemProjects((prev) => [...prev, newProject]);
      setSearch('');
      toast(`Created and assigned "${newProject.name}"`, { duration: 2000 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setCreating(false);
    }
  }, [search, itemId]);

  const filtered = allProjects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );
  const showCreateOption =
    search.trim() &&
    !allProjects.some(
      (p) => p.name.toLowerCase() === search.trim().toLowerCase(),
    );

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Projects
      </h2>

      {/* Assigned project badges */}
      {itemProjects.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {itemProjects.map((project) => (
            <span
              key={project.id}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              {project.name}
              <button
                onClick={() => handleToggle(project)}
                className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-foreground/10"
                aria-label={`Remove from ${project.name}`}
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
            {itemProjects.length === 0 ? 'Add to project' : 'Manage projects'}
            <ChevronsUpDown className="size-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <Input
            ref={inputRef}
            placeholder="Search or create project..."
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
                {filtered.map((project) => {
                  const assigned = isAssigned(project.id);
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => handleToggle(project)}
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
                        style={{ backgroundColor: project.color }}
                      />
                      <span className="truncate">{project.name}</span>
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
                    No projects found
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
export function ProjectBadge({
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
