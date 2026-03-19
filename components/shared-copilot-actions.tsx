'use client';

import { useCopilotAction } from '@copilotkit/react-core';
import { SearchingIndicator } from '@/components/copilot-ui/searching-indicator';
import { KBSearchResults } from '@/components/copilot-ui/kb-search-results';
import { searchKnowledgeBase } from '@/lib/copilotkit/shared-actions';
import { ingestUrl, ingestText, createQAPair } from '@/lib/copilotkit/ingestion-actions';
import type { IngestResult } from '@/lib/copilotkit/ingestion-actions';
import { IngestionProgress } from '@/components/ingestion-progress';
import { usePathname } from 'next/navigation';
import { useHydrated } from '@/hooks/use-hydrated';
import { useUserRole } from '@/hooks/use-user-role';
import { isPublicRoute } from '@/lib/routes';

/**
 * Compact result card for ingestion actions in the CopilotKit sidebar.
 */
function IngestResultCard({ result }: { result: IngestResult }) {
  return (
    <div className="rounded-md border bg-status-success/10 px-3 py-2 text-sm">
      <div className="font-medium">
        <a
          href={`/item/${result.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          {result.title}
        </a>
      </div>
      {(result.contentType || result.domain) && (
        <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
          {result.contentType && <span>{result.contentType.replace(/_/g, ' ')}</span>}
          {result.domain && <span>{result.domain.replace(/-/g, ' ')}</span>}
        </div>
      )}
      {result.warnings && result.warnings.length > 0 && (
        <div className="mt-1 text-xs text-status-warning">
          {result.warnings.join('; ')}
        </div>
      )}
    </div>
  );
}

/**
 * Inner component for ingestion actions — only rendered for editor+ users.
 * Separated to avoid conditional hook warnings.
 */
/** Parse comma-separated tags from CopilotKit string parameter */
function parseTags(tags?: string): string[] | undefined {
  if (!tags) return undefined;
  const parsed = tags.split(',').map(t => t.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

/** Render function for ingestion action results */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderIngestResult({ result, status }: { result: any; status: string }, progressSteps: Array<{ label: string; status: 'pending' | 'active' | 'done' }>) {
  if (status === 'inProgress' || status === 'executing') {
    return <IngestionProgress compact steps={progressSteps} />;
  }
  if (result && 'error' in result) {
    return (
      <div className="rounded-md border bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {result.error}
      </div>
    );
  }
  if (result) return <IngestResultCard result={result as IngestResult} />;
  return <></>;
}

function IngestionActionsInner() {
  useCopilotAction({
    name: 'ingestUrl',
    description:
      'Import a web page into the Knowledge Base by URL. Fetches the page, extracts text, classifies, embeds, and summarises automatically. Use when the user shares a URL and wants to add it to the KB.',
    parameters: [
      { name: 'url', type: 'string', description: 'The web page URL to import', required: true },
      { name: 'content_type', type: 'string', description: 'Content type override (e.g., article, blog, policy, research)', required: false },
      { name: 'user_tags', type: 'string', description: 'Comma-separated tags to apply to the imported item', required: false },
    ],
    handler: async ({ url, content_type, user_tags }) => {
      return ingestUrl({ url, content_type, user_tags: parseTags(user_tags) });
    },
    render: (props) => renderIngestResult(props, [
      { label: 'Fetching page', status: 'done' },
      { label: 'Extracting text', status: 'active' },
      { label: 'Classifying', status: 'pending' },
      { label: 'Generating summary', status: 'pending' },
    ]),
  });

  useCopilotAction({
    name: 'ingestText',
    description:
      'Add pasted text content to the Knowledge Base. Creates a new content item with automatic classification, embedding, and summarisation. Use when the user pastes text and wants to save it as a KB item.',
    parameters: [
      { name: 'title', type: 'string', description: 'Title for the content item', required: true },
      { name: 'content', type: 'string', description: 'The text content to store', required: true },
      { name: 'content_type', type: 'string', description: 'Content type (e.g., article, policy, note, guide)', required: false },
      { name: 'primary_domain', type: 'string', description: 'Primary domain classification', required: false },
      { name: 'user_tags', type: 'string', description: 'Comma-separated tags to apply', required: false },
    ],
    handler: async ({ title, content, content_type, primary_domain, user_tags }) => {
      return ingestText({ title, content, content_type, primary_domain, user_tags: parseTags(user_tags) });
    },
    render: (props) => renderIngestResult(props, [
      { label: 'Creating item', status: 'active' },
      { label: 'Classifying', status: 'pending' },
      { label: 'Generating summary', status: 'pending' },
    ]),
  });

  useCopilotAction({
    name: 'createQAPair',
    description:
      'Create a Q&A pair in the Knowledge Base. Use when the user provides a question and answer to store as a bid library entry.',
    parameters: [
      { name: 'question', type: 'string', description: 'The question text', required: true },
      { name: 'answer', type: 'string', description: 'The answer text', required: true },
      { name: 'primary_domain', type: 'string', description: 'Primary domain classification', required: false },
      { name: 'user_tags', type: 'string', description: 'Comma-separated tags to apply', required: false },
    ],
    handler: async ({ question, answer, primary_domain, user_tags }) => {
      return createQAPair({ question, answer, primary_domain, user_tags: parseTags(user_tags) });
    },
    render: (props) => renderIngestResult(props, [
      { label: 'Creating Q&A pair', status: 'active' },
      { label: 'Classifying', status: 'pending' },
    ]),
  });

  return null;
}

/**
 * Inner component that registers CopilotKit actions.
 * Only rendered after hydration when CopilotKit context is available.
 */
function SharedActionsInner() {
  const { canEdit } = useUserRole();

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

  // Ingestion actions — editor+ only (separate component to avoid conditional hooks)
  if (!canEdit) return null;
  return <IngestionActionsInner />;
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
