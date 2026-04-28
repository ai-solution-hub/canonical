'use client';

import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { PromptEditor } from '@/components/intelligence/prompt-editor';
import { PromptVersionSidebar } from '@/components/intelligence/prompt-version-sidebar';
import { RefinementPanel } from '@/components/intelligence/prompt-refinement/refinement-panel';
import {
  useFeedPrompts,
  useCreatePromptVersion,
  useRollbackPrompt,
} from '@/hooks/intelligence/use-feed-prompts';
import type { FeedPrompt } from '@/hooks/intelligence/use-feed-prompts';
import { useWorkspaceFlags } from '@/hooks/intelligence/use-workspace-flags';
import { useAnalyseFlags } from '@/hooks/intelligence/use-analyse-flags';
import { useRescoringPreview } from '@/hooks/intelligence/use-rescoring-preview';
import { useResolveFlags } from '@/hooks/intelligence/use-resolve-flags';
import { useUserRole } from '@/hooks/use-user-role';

/**
 * Prompts page — restructured for the SI Prompt Refinement flow (S158 WP1).
 *
 * Layout:
 *   +-------------------------------------+----------------+
 *   | RefinementPanel (primary)           | VersionSidebar |
 *   |                                     |                |
 *   | [Advanced: Edit directly ▾]         |                |
 *   |   PromptEditor (collapsed)          |                |
 *   +-------------------------------------+----------------+
 *
 * The refinement panel drives the guided "analyse → preview → apply"
 * flow via the three WP1a mutation hooks. "Apply changes" atomically
 * creates a new prompt version and marks the analysed flags as
 * addressed against that version. The existing PromptEditor remains
 * available behind an "Advanced" disclosure so power users can still
 * edit prompt text directly. The version sidebar is unchanged and
 * shows versions from both creation paths identically.
 *
 * Admin-only access (existing gate preserved).
 */
export default function PromptsPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  // ---------------------------------------------------------------
  // Role gate — preserved from the pre-S158 version
  // ---------------------------------------------------------------
  const { role } = useUserRole();
  const isAdmin = role === 'admin';

  // ---------------------------------------------------------------
  // Data: prompts + unresolved flags
  // ---------------------------------------------------------------
  const { data: prompts, isLoading: promptsLoading } =
    useFeedPrompts(workspaceId);
  const { data: flags, isLoading: flagsLoading } = useWorkspaceFlags(
    workspaceId,
    {
      resolved: false,
    },
  );

  const activePrompt = useMemo(
    () => prompts?.find((p) => p.is_active) ?? null,
    [prompts],
  );

  // ---------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------
  const createVersion = useCreatePromptVersion(workspaceId);
  const rollback = useRollbackPrompt(workspaceId);
  const analyseFlagsMutation = useAnalyseFlags(workspaceId);
  const rescoringPreviewMutation = useRescoringPreview(workspaceId);
  const resolveFlagsMutation = useResolveFlags(workspaceId);

  // Destructure before using in useCallback deps (React compiler rule).
  const { mutateAsync: createVersionAsync } = createVersion;
  const { mutate: rollbackMutate } = rollback;

  // ---------------------------------------------------------------
  // Refinement-panel "Apply changes" bridge
  // ---------------------------------------------------------------
  const handleApplyVersion = useCallback(
    async (
      promptText: string,
      changeNotes: string,
    ): Promise<{ id: string } | null> => {
      try {
        const newVersion = await createVersionAsync({
          prompt_text: promptText,
          change_notes: changeNotes,
        });
        return { id: newVersion.id };
      } catch {
        // createVersion's own onError toast already fired — return null so
        // the refinement panel can surface its "applying failed" state.
        return null;
      }
    },
    [createVersionAsync],
  );

  // ---------------------------------------------------------------
  // Advanced-editor disclosure (not persisted per spec §Task 12)
  // ---------------------------------------------------------------
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [viewingText, setViewingText] = useState<string | null>(null);

  const handleViewVersion = useCallback((version: FeedPrompt) => {
    setViewingText(version.prompt_text);
    setShowAdvanced(true);
  }, []);

  const handleRollback = useCallback(
    (versionId: string) => {
      rollbackMutate(versionId);
      setViewingText(null);
    },
    [rollbackMutate],
  );

  // ---------------------------------------------------------------
  // Render gates
  // ---------------------------------------------------------------
  if (role !== null && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border bg-card p-12 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">
          You don&apos;t have access to this section.
        </p>
      </div>
    );
  }

  if (promptsLoading) {
    return (
      <div role="status" aria-label="Loading prompts">
        <span className="sr-only">Loading...</span>
        <div className="h-64 animate-pulse rounded-lg border bg-card" />
      </div>
    );
  }

  if (!prompts?.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border bg-card p-12 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">
          No filter rules configured for this workspace yet.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      {/* Main column — refinement panel + collapsible editor */}
      <div className="space-y-4 lg:col-span-3">
        <RefinementPanel
          workspaceId={workspaceId}
          flags={flags}
          flagsLoading={flagsLoading}
          activePromptText={activePrompt?.prompt_text ?? null}
          activePromptVersionId={activePrompt?.id ?? null}
          analyseFlagsMutation={analyseFlagsMutation}
          rescoringPreviewMutation={rescoringPreviewMutation}
          resolveFlagsMutation={resolveFlagsMutation}
          onApplyVersion={handleApplyVersion}
        />

        {/* Advanced editor disclosure — resets to collapsed on each page load. */}
        <div className="rounded-lg border bg-card shadow-sm">
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            aria-expanded={showAdvanced}
            aria-controls="advanced-prompt-editor"
            className="flex w-full items-center gap-2 p-4 text-sm font-medium text-foreground hover:bg-muted/50"
          >
            {showAdvanced ? (
              <ChevronDown className="size-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4" aria-hidden="true" />
            )}
            <Pencil
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span>Advanced: edit prompt directly</span>
          </button>
          {showAdvanced && (
            <div id="advanced-prompt-editor" className="border-t p-6">
              <PromptEditor
                workspaceId={workspaceId}
                currentPrompt={activePrompt}
                viewingText={viewingText}
                isAdmin={isAdmin}
                onSave={(data) => createVersion.mutate(data)}
                isSaving={createVersion.isPending}
              />
              {viewingText !== null && (
                <button
                  onClick={() => setViewingText(null)}
                  className="mt-3 text-sm text-muted-foreground underline hover:text-foreground"
                >
                  Return to active version
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sidebar — version history (unchanged) */}
      <div className="rounded-lg border bg-card p-4 shadow-sm lg:col-span-1">
        <PromptVersionSidebar
          versions={prompts}
          activeVersionId={activePrompt?.id ?? null}
          onView={handleViewVersion}
          onRollback={handleRollback}
          isRollingBack={rollback.isPending}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  );
}
