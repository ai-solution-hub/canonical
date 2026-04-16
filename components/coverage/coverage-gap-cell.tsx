'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';
import { generateCoverageGapPrompt } from '@/lib/claude-prompts';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverageGapCellProps {
  domainName: string;
  subtopicName: string;
  formatSubtopic: (subtopic: string) => string;
}

// ---------------------------------------------------------------------------
// Coverage Gap Cell — subtopic with 0 items
// ---------------------------------------------------------------------------

export function CoverageGapCell({
  domainName,
  subtopicName,
  formatSubtopic,
}: CoverageGapCellProps) {
  const claudePrompt = generateCoverageGapPrompt(domainName, subtopicName);

  return (
    <div
      className={cn(
        'group flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 p-3',
        'min-h-[5.5rem]',
      )}
    >
      <span className="text-xs font-medium text-muted-foreground">
        {formatSubtopic(subtopicName)}
      </span>
      <span className="text-xs text-muted-foreground/80">No content</span>
      <div className="flex items-center gap-1">
        <Link
          href={`/browse?domain=${encodeURIComponent(domainName)}&subtopic=${encodeURIComponent(subtopicName)}`}
          className={cn(
            'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground',
            'transition-colors hover:bg-accent hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label={`${formatSubtopic(subtopicName)} — browse`}
        >
          <Plus className="size-3" aria-hidden="true" />
          Add
        </Link>
        <ClaudePromptButton
          prompt={claudePrompt.prompt}
          label="Draft with Claude"
          size="sm"
          className="h-auto px-1.5 py-0.5"
        />
      </div>
    </div>
  );
}
