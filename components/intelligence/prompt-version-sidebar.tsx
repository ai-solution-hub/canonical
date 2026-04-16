'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye, RotateCcw } from 'lucide-react';
import type { FeedPrompt } from '@/hooks/intelligence/use-feed-prompts';

interface PromptVersionSidebarProps {
  versions: FeedPrompt[];
  activeVersionId: string | null;
  onView: (version: FeedPrompt) => void;
  onRollback: (versionId: string) => void;
  isRollingBack: boolean;
  isAdmin: boolean;
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
  if (diffHours < 24)
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function PromptVersionSidebar({
  versions,
  activeVersionId,
  onView,
  onRollback,
  isRollingBack,
  isAdmin,
}: PromptVersionSidebarProps) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Filter rule history
      </h3>
      {versions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No versions yet.</p>
      ) : (
        <div className="space-y-3">
          {versions.map((prompt) => {
            const isActive = prompt.id === activeVersionId;
            const snapshot = prompt.performance_snapshot;

            return (
              <div
                key={prompt.id}
                className="space-y-1.5 border-b pb-3 last:border-b-0 last:pb-0"
              >
                {/* Version header */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    v{prompt.version}
                  </span>
                  {isActive && (
                    <Badge
                      variant="outline"
                      className="border-success/30 bg-success/10 text-xs text-success"
                    >
                      Active
                    </Badge>
                  )}
                </div>

                {/* Change notes */}
                {prompt.change_notes && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {prompt.change_notes}
                  </p>
                )}

                {/* Performance snapshot */}
                {snapshot && (
                  <div className="rounded-md bg-accent/50 p-2 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Articles scored</span>
                      <span className="font-medium text-foreground">
                        {snapshot.total_articles}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Pass rate</span>
                      <span className="font-medium text-foreground">
                        {snapshot.pass_rate}%
                      </span>
                    </div>
                  </div>
                )}

                {/* Date */}
                <p className="text-xs text-muted-foreground">
                  {formatRelativeDate(prompt.created_at)}
                </p>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onView(prompt)}
                    className="h-auto gap-1 p-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Eye className="size-3" aria-hidden="true" />
                    View
                  </Button>
                  {!isActive && isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Roll back to version ${prompt.version}? This creates a new version with that prompt text.`,
                          )
                        ) {
                          onRollback(prompt.id);
                        }
                      }}
                      disabled={isRollingBack}
                      className="h-auto gap-1 p-0 text-xs text-destructive hover:text-destructive/80"
                    >
                      <RotateCcw className="size-3" aria-hidden="true" />
                      {isRollingBack ? 'Rolling back...' : 'Rollback'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
