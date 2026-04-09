'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { PromptEditor } from '@/components/intelligence/prompt-editor';
import { PromptVersionSidebar } from '@/components/intelligence/prompt-version-sidebar';
import {
  useFeedPrompts,
  useCreatePromptVersion,
  useRollbackPrompt,
} from '@/hooks/intelligence/use-feed-prompts';
import type { FeedPrompt } from '@/hooks/intelligence/use-feed-prompts';
import { useUserRole } from '@/hooks/use-user-role';

export default function PromptsPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const { data: prompts, isLoading } = useFeedPrompts(workspaceId);
  const createVersion = useCreatePromptVersion(workspaceId);
  const rollback = useRollbackPrompt(workspaceId);
  const { role } = useUserRole();
  const isAdmin = role === 'admin';

  const [viewingText, setViewingText] = useState<string | null>(null);

  if (role !== null && role !== 'admin' && role !== 'editor') {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border bg-card p-12 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">
          You don&apos;t have access to this section.
        </p>
      </div>
    );
  }

  const activePrompt = prompts?.find((p) => p.is_active) ?? null;

  function handleViewVersion(version: FeedPrompt) {
    setViewingText(version.prompt_text);
  }

  function handleRollback(versionId: string) {
    rollback.mutate(versionId);
    setViewingText(null);
  }

  if (isLoading) {
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
      {/* Main editor area */}
      <div className="rounded-lg border bg-card p-6 shadow-sm lg:col-span-3">
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

      {/* Sidebar — version history */}
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
