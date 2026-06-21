/**
 * One workspace-level flag as returned by
 * `GET /api/intelligence/workspaces/:id/flags`.
 *
 * Canonical shape shared by the API route (which produces it) and the
 * `useWorkspaceFlags` hook (which consumes it). The route flattens the joined
 * `feed_articles` / `feed_sources` relations before serialising, so consumers
 * never have to walk nested objects.
 */
/** @public */
export interface WorkspaceFlag {
  id: string;
  feed_article_id: string;
  flag_type: 'false_positive' | 'false_negative';
  flagged_by: string;
  notes: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_notes: string | null;
  resolution_type: string | null;
  prompt_version_id: string | null;
  created_at: string;
  // Joined article + source context (flattened by the API).
  article_title: string | null;
  article_external_url: string | null;
  article_relevance_score: number | null;
  article_relevance_reasoning: string | null;
  article_relevance_category: string | null;
  article_passed: boolean | null;
  source_name: string | null;
}
