'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';

interface GuideSectionEmptyProps {
  domainFilter: string | null;
  subtopicFilter: string | null;
  expectedLayer: string | null;
  /** Section name for the Claude prompt context */
  sectionName?: string;
  /** Guide name for the Claude prompt context */
  guideName?: string;
}

export function GuideSectionEmpty({
  domainFilter,
  subtopicFilter,
  expectedLayer,
  sectionName,
  guideName,
}: GuideSectionEmptyProps) {
  // Build pre-filled create link
  const params = new URLSearchParams();
  if (domainFilter) params.set('domain', domainFilter);
  if (subtopicFilter) params.set('subtopic', subtopicFilter);
  if (expectedLayer) params.set('layer', expectedLayer);
  const createHref = `/item/new${params.toString() ? `?${params.toString()}` : ''}`;

  // Build Claude prompt
  const claudePrompt = sectionName
    ? `We need content for the "${sectionName}" section${guideName ? ` in the "${guideName}" guide` : ''}${domainFilter ? ` (${domainFilter.replace(/-/g, ' ')} domain)` : ''}. Search the KB for any related content, then help me draft material to fill this section.`
    : undefined;

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
      <p className="text-xs text-muted-foreground">No content yet</p>
      <div className="mt-2 flex items-center justify-center gap-2">
        <Link
          href={createHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3" aria-hidden="true" />
          Create content
        </Link>
        {claudePrompt && (
          <ClaudePromptButton
            prompt={claudePrompt}
            label="Suggest content"
            size="sm"
            className="h-auto px-1.5 py-0.5"
          />
        )}
      </div>
    </div>
  );
}
