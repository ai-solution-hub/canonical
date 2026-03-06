'use client';

import { useState, useCallback } from 'react';
import { Plus, ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ProjectCard, type ProjectWithCounts } from '@/components/project-card';
import { ProjectCreateDialog } from '@/components/project-create-dialog';
import { ProjectDetailSheet } from '@/components/project-detail-sheet';
import { useUserRole } from '@/hooks/use-user-role';
import type { Project } from '@/types/content';

interface ProjectsContentProps {
  initialProjects: Project[];
  initialCounts: Record<
    string,
    { item_count: number; last_activity: string | null }
  >;
}

function enrichProjects(
  projects: Project[],
  counts: Record<string, { item_count: number; last_activity: string | null }>,
): ProjectWithCounts[] {
  return projects.map((p) => ({
    ...p,
    item_count: counts[p.id]?.item_count ?? 0,
    last_activity: counts[p.id]?.last_activity ?? null,
  }));
}

export function ProjectsContent({
  initialProjects,
  initialCounts,
}: ProjectsContentProps) {
  const { canEdit, canAdmin } = useUserRole();
  const [projects, setProjects] = useState<ProjectWithCounts[]>(() =>
    enrichProjects(initialProjects, initialCounts),
  );
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editProject, setEditProject] = useState<ProjectWithCounts | null>(
    null,
  );
  const [showArchived, setShowArchived] = useState(false);

  const activeProjects = projects.filter((p) => !p.is_archived);
  const archivedProjects = projects.filter((p) => p.is_archived);

  const handleCreated = useCallback((newProject: Project) => {
    const enriched: ProjectWithCounts = {
      ...newProject,
      item_count: 0,
      last_activity: null,
    };
    setProjects((prev) =>
      [...prev, enriched].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, []);

  const handleUpdated = useCallback((updated: ProjectWithCounts) => {
    setProjects((prev) =>
      prev
        .map((p) => (p.id === updated.id ? updated : p))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setEditProject((prev) =>
      prev?.id === updated.id ? updated : prev,
    );
  }, []);

  const handleArchiveToggle = useCallback(
    async (project: ProjectWithCounts) => {
      const newArchived = !project.is_archived;
      const label = newArchived ? 'Archived' : 'Unarchived';

      // Optimistic update
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id ? { ...p, is_archived: newArchived } : p,
        ),
      );

      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_archived: newArchived }),
        });
        if (!res.ok) throw new Error();

        toast(`${label} "${project.name}"`, {
          duration: 3000,
          action: {
            label: 'Undo',
            onClick: async () => {
              // Revert
              setProjects((prev) =>
                prev.map((p) =>
                  p.id === project.id
                    ? { ...p, is_archived: !newArchived }
                    : p,
                ),
              );
              await fetch(`/api/projects/${project.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_archived: !newArchived }),
              });
            },
          },
        });
      } catch {
        // Rollback
        setProjects((prev) =>
          prev.map((p) =>
            p.id === project.id ? { ...p, is_archived: !newArchived } : p,
          ),
        );
        toast.error(`Failed to ${label.toLowerCase()} project`);
      }
    },
    [],
  );

  const handleDeleted = useCallback((projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  }, []);

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-fluid-2xl font-bold tracking-tight">Projects</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your project collections.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => setShowCreateDialog(true)}
            className="gap-1.5"
          >
            <Plus className="size-4" />
            New Project
          </Button>
        )}
      </div>

      {/* Active projects */}
      <section className="mt-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Active Projects ({activeProjects.length})
        </h2>

        {activeProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
            <FolderOpen className="mb-3 size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No projects yet. Create your first project to start organising
              content.
            </p>
            {canEdit && (
              <Button
                variant="outline"
                className="mt-4 gap-1.5"
                onClick={() => setShowCreateDialog(true)}
              >
                <Plus className="size-4" />
                Create Project
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onEdit={setEditProject}
                onArchiveToggle={handleArchiveToggle}
                readOnly={!canEdit}
              />
            ))}
          </div>
        )}
      </section>

      {/* Archived projects */}
      {archivedProjects.length > 0 && (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setShowArchived((prev) => !prev)}
            aria-expanded={showArchived}
            aria-controls="archived-projects"
            className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            {showArchived ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            Archived Projects ({archivedProjects.length})
          </button>

          {showArchived && (
            <div id="archived-projects" className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {archivedProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onEdit={setEditProject}
                  onArchiveToggle={handleArchiveToggle}
                  readOnly={!canEdit}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Create dialog */}
      <ProjectCreateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleCreated}
      />

      {/* Detail sheet */}
      <ProjectDetailSheet
        project={editProject}
        open={!!editProject}
        onOpenChange={(v) => {
          if (!v) setEditProject(null);
        }}
        onUpdated={handleUpdated}
        onArchiveToggle={handleArchiveToggle}
        onDeleted={handleDeleted}
        readOnly={!canEdit}
        isAdmin={canAdmin}
      />
    </>
  );
}
