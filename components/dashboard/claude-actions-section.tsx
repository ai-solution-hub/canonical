'use client';

import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ClaudePromptButton } from '@/components/claude-prompt-button';
import { useClaudeConnected } from '@/hooks/use-claude-connected';
import { cn } from '@/lib/utils';
import type { ClaudePrompt } from '@/lib/claude-prompts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClaudeActionsSectionProps {
  actions: ClaudePrompt[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dashboard section showing 3-5 contextual Claude prompts based on
 * what needs attention. Each prompt can be copied and opened in Claude.
 *
 * Only renders when there are actionable items.
 */
const COLLAPSE_KEY = 'claude-actions-collapsed';

export function ClaudeActionsSection({ actions }: ClaudeActionsSectionProps) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(COLLAPSE_KEY) === 'true';
  });
  const claudeConnected = useClaudeConnected();

  if (actions.length === 0) return null;

  return (
    <section
      aria-label="Suggested actions for Claude"
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-4" aria-hidden="true" />
          Take Action with Claude
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <a
              href="https://claude.ai/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Claude
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={() => setCollapsed((prev) => {
              const next = !prev;
              localStorage.setItem(COLLAPSE_KEY, String(next));
              return next;
            })}
            aria-label={collapsed ? 'Expand Claude actions' : 'Collapse Claude actions'}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronUp className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          {claudeConnected === false && (
            <p className="mt-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Connect Knowledge Hub to Claude first —{' '}
              <a href="/settings?section=integrations" className="font-medium text-foreground underline underline-offset-2 hover:text-primary">
                go to Settings
              </a>{' '}
              to set up the MCP connector.
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Based on what needs attention, try these prompts in Claude:
          </p>

          <div className="mt-3 space-y-2">
            {actions.map((action, idx) => (
              <div
                key={idx}
                className={cn(
                  'flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3',
                  'transition-colors hover:bg-muted/50',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground line-clamp-2">
                    &ldquo;{action.prompt}&rdquo;
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {action.description}
                  </p>
                </div>
                <ClaudePromptButton
                  prompt={action.prompt}
                  label="Copy"
                  size="sm"
                  className="shrink-0"
                />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
