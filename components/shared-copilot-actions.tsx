'use client';

import { useCopilotAction } from '@copilotkit/react-core';
import { SearchingIndicator } from '@/components/copilot-ui/searching-indicator';
import { KBSearchResults } from '@/components/copilot-ui/kb-search-results';
import { searchKnowledgeBase } from '@/lib/copilotkit/shared-actions';
import { usePathname } from 'next/navigation';
import { useHydrated } from '@/hooks/use-hydrated';
import { isPublicRoute } from '@/lib/routes';

/**
 * Inner component that registers CopilotKit actions.
 * Only rendered after hydration when CopilotKit context is available.
 */
function SharedActionsInner() {
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
    handler: searchKnowledgeBase,
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

/**
 * Shared CopilotKit actions available on every page.
 * Mounted at the root layout level. Page-specific components may register
 * their own version of an action with the same name — the most recently
 * registered version takes precedence (CopilotKit's designed behaviour).
 * Deferred until after hydration so the CopilotKit provider is mounted.
 */
export function SharedCopilotActions() {
  const hydrated = useHydrated();
  const pathname = usePathname();

  // Skip when CopilotKit context is not available
  if (process.env.NEXT_PUBLIC_E2E === 'true') return null;
  if (isPublicRoute(pathname)) return null;
  if (!hydrated) return null;

  return <SharedActionsInner />;
}
