'use client';

import { useCopilotAction } from '@copilotkit/react-core';
import { SearchingIndicator } from '@/components/copilot-ui/searching-indicator';
import { KBSearchResults } from '@/components/copilot-ui/kb-search-results';

/**
 * Shared CopilotKit actions available on every page.
 * Mounted at the root layout level. Page-specific components may register
 * their own version of an action with the same name — the most recently
 * registered version takes precedence (CopilotKit's designed behaviour).
 */
export function SharedCopilotActions() {
  useCopilotAction({
    name: 'searchKnowledgeBase',
    description:
      'Search the knowledge base for content relevant to a query. Use this when the user asks to find content, search for information, or wants to know what relevant material exists.',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'The search query',
        required: true,
      },
      {
        name: 'domain',
        type: 'string',
        description: 'Optional domain filter (e.g., security, compliance, methodology)',
        required: false,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Number of results to return (default 5, max 10)',
        required: false,
      },
    ],
    handler: async ({
      query,
      domain,
      limit,
    }: {
      query: string;
      domain?: string;
      limit?: number;
    }) => {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          domain: domain ?? undefined,
          limit: Math.min(limit ?? 5, 10),
        }),
      });

      if (!response.ok) {
        return { error: 'Search failed. Please try again.' };
      }

      const data = await response.json();
      return {
        results: (data.results ?? []).map(
          (r: Record<string, unknown>) => ({
            id: r.id,
            title: r.suggested_title ?? r.title ?? 'Untitled',
            type: r.content_type,
            domain: r.primary_domain,
            similarity: r.similarity,
            summary: typeof r.ai_summary === 'string'
              ? r.ai_summary.slice(0, 200)
              : undefined,
          }),
        ),
        totalFound: data.results?.length ?? 0,
      };
    },
    render: ({ result, status }) => {
      if (status === 'inProgress' || status === 'executing') {
        return <SearchingIndicator />;
      }
      if (!result?.results?.length) {
        return (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            No matching content found in the knowledge base.
          </div>
        );
      }
      return <KBSearchResults results={result.results} />;
    },
  });

  return null;
}
