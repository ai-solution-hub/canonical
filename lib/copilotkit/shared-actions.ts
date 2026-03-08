// ---------------------------------------------------------------------------
// Shared action handlers — pure functions with no React dependencies
// ---------------------------------------------------------------------------

/**
 * Search result shape returned by the shared search handler.
 */
export interface KBSearchResult {
  id: unknown;
  title: string;
  type: unknown;
  domain: unknown;
  similarity: unknown;
  summary: string | undefined;
}

/**
 * Shared handler for the `searchKnowledgeBase` CopilotKit action.
 *
 * Calls `/api/search` and maps results to a consistent shape.
 * Used by `SharedCopilotActions` (global). The bid-session version in
 * `BidCopilotActions` duplicates this logic but additionally includes a
 * `snippet` field in each result — that version is intentionally separate
 * to avoid coupling the bid-specific result shape to the shared handler.
 */
export async function searchKnowledgeBase({
  query,
  domain,
  limit,
}: {
  query: string;
  domain?: string;
  limit?: number;
}): Promise<{ results: KBSearchResult[]; totalFound: number } | { error: string }> {
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
        title: (r.suggested_title ?? r.title ?? 'Untitled') as string,
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
}
