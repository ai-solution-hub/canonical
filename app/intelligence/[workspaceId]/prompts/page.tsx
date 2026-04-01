'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { PromptEditor } from '@/components/intelligence/prompt-editor';
import {
  useFeedPrompts,
  useCreatePromptVersion,
  useRollbackPrompt,
} from '@/hooks/intelligence/use-feed-prompts';
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

  const activePrompt = prompts?.find((p) => p.is_active) ?? null;

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
          No prompts configured. This should not happen — contact admin.
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

      {/* Sidebar — version history (Task 11 will add PromptVersionSidebar) */}
      <div className="rounded-lg border bg-card p-4 shadow-sm lg:col-span-1">
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Version History
        </h3>
        <div className="space-y-3">
          {prompts.map((prompt) => (
            <div
              key={prompt.id}
              className="space-y-1 border-b pb-3 last:border-b-0 last:pb-0"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  v{prompt.version}
                </span>
                {prompt.is_active && (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                    Active
                  </span>
                )}
              </div>
              {prompt.change_notes && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {prompt.change_notes}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {formatRelativeDate(prompt.created_at)}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setViewingText(prompt.prompt_text)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  View
                </button>
                {!prompt.is_active && isAdmin && (
                  <button
                    onClick={() => {
                      if (window.confirm(`Roll back to version ${prompt.version}? This creates a new version with that prompt text.`)) {
                        rollback.mutate(prompt.id);
                        setViewingText(null);
                      }
                    }}
                    disabled={rollback.isPending}
                    className="text-xs text-destructive underline hover:text-destructive/80 disabled:opacity-50"
                  >
                    {rollback.isPending ? 'Rolling back...' : 'Rollback'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
